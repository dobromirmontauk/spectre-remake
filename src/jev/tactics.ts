import type {TankObservation,TacticalPlan} from './types.ts';
import type {Vec2} from '../sim/types.ts';
import {dsin,dcos,datan2} from '../sim/dmath.ts';
import {segmentVsCircle} from '../sim/collision.ts';
import {TANK_RADIUS,PROJECTILE_RADIUS} from '../config/constants.ts';
import {clearNavigationSegment} from './navigation.ts';
import {clearFriendlyRoute} from './routes.ts';
import {angleDelta,distance,blocked} from './observation.ts';
import {PLAN_TICKS,SAFETY_MARGIN,MISSION_STEP_DISTANCE,MOTION_STALL_TICKS} from './config.ts';
export function buildMissionCandidates(o:TankObservation,origin:Vec2):TacticalPlan[]{
 const m=o.mission!;const plans:TacticalPlan[]=[];
 const threat=m.targetId?o.contacts.find(c=>c.kind==='tank'&&c.team!==o.own.team&&c.id===m.targetId):o.contacts.filter(c=>c.kind==='tank'&&c.team!==o.own.team&&(c.source==='own'||c.source===undefined)).sort((a,b)=>distance(origin,a.position)-distance(origin,b.position))[0];
 const ownTarget=threat&&(threat.source==='own'||threat.source===undefined)?threat:undefined;
 const afraid=!!o.recentThreat||o.own.shieldFraction<.35||m.kind==='recover';
 const stalled=!o.own.motionFeedback?.firedRecently&&((o.own.motionFeedback?.stalledTicks??0)>=MOTION_STALL_TICKS||(o.own.motionFeedback?.blockedTicks??0)>=15);
 const add=(tactic:NonNullable<TacticalPlan['tactic']>,suffix:string,destination:Vec2,fire=false)=>{
  if(Math.abs(destination.x)>o.bounds-4||Math.abs(destination.z)>o.bounds-4||!clearNavigationSegment(origin,destination,o.geometry,TANK_RADIUS+SAFETY_MARGIN)||!clearFriendlyRoute(o,origin,destination))return;
  if(stalled&&tactic==='advance'&&o.own.motionFeedback?.failedWaypoint&&distance(destination,o.own.motionFeedback.failedWaypoint)<4)return;
  const strategy=tactic==='evade'||tactic==='cover'?'retreat':tactic==='fire'?'protect':m.kind==='attack'||m.kind==='intercept'?'pursue':'explore';
  plans.push({id:tactic+':'+suffix,missionId:m.id,tactic,strategy,description:'Action '+tactic+': execute '+m.kind+' mission '+m.id+' as '+m.role+'; '+(tactic==='evade'||tactic==='cover'?'temporary survival maneuver, then resume mission; ':'')+'travel '+Math.round(distance(origin,destination))+' units at '+Math.round(angleDelta(datan2(destination.x-origin.x,destination.z-origin.z),o.own.heading)*180/Math.PI)+' degrees; known route and friendly clearance checked'+(stalled?'; recent motion stalled, change lane':'')+(fire?'; fire only at own visible target when locally safe':''),waypoint:destination,targetId:ownTarget?.id??m.targetId,fire:fire&&!!ownTarget,lookAt:ownTarget?{...ownTarget.position}:m.track?{...m.track.position}:undefined,expiresTick:o.own.tick+PLAN_TICKS});
 };
 let goal=m.waypoint;
 if(ownTarget&&m.kind==='attack'){const gap=Math.max(1,distance(origin,ownTarget.position)),dx=(origin.x-ownTarget.position.x)/gap,dz=(origin.z-ownTarget.position.z)/gap,side=m.role==='flanker'?14:0;goal={x:ownTarget.position.x+dx*14-dz*side,z:ownTarget.position.z+dz*14+dx*side};}
 const bearing=datan2(goal.x-origin.x,goal.z-origin.z),range=distance(origin,goal),step=Math.min(MISSION_STEP_DISTANCE,range);
 const arrival={x:origin.x+dsin(bearing)*step,z:origin.z+dcos(bearing)*step};
 if(!afraid)add('advance','mission',arrival,!!ownTarget);
 if(ownTarget&&!afraid&&(m.kind==='attack'||m.kind==='intercept')){
  const laneBlocked=o.contacts.some(c=>c.kind==='tank'&&c.team===o.own.team&&c.id!==o.own.id&&segmentVsCircle(origin,ownTarget.position,c.position,TANK_RADIUS+PROJECTILE_RADIUS+SAFETY_MARGIN).hit);
  if(!laneBlocked&&!blocked(origin,ownTarget.position,o.geometry)&&!stalled)add('fire','visible',origin,true);
 }
 for(const [index,offset]of [-Math.PI/4,Math.PI/4,-Math.PI/2,Math.PI/2].entries()){
  const direction=bearing+offset;const p={x:origin.x+dsin(direction)*(stalled?12:8),z:origin.z+dcos(direction)*(stalled?12:8)};
  // Lateral maneuver remains a short local lane change toward the same mission.
  add(afraid?'cover':'reposition','lane-'+index,p,!!ownTarget);
 }
 if(afraid){
  const away=ownTarget?datan2(origin.x-ownTarget.position.x,origin.z-ownTarget.position.z):m.track?datan2(origin.x-m.track.position.x,origin.z-m.track.position.z):o.recentThreat?.direction?datan2(-o.recentThreat.direction.x,-o.recentThreat.direction.z):bearing;
  for(const [index,offset]of [0,-Math.PI/4,Math.PI/4].entries())add('evade','sector-'+index,{x:origin.x+dsin(away+offset)*14,z:origin.z+dcos(away+offset)*14},!!ownTarget);
 }
 // When geometry/crowding rejects the goal, bounded local escape never changes mission.
 if(!plans.length)for(let i=0;i<8;i++){const angle=i*Math.PI/4;add('reposition','blocked-'+i,{x:origin.x+dsin(angle)*6,z:origin.z+dcos(angle)*6});}
 if(!plans.length)plans.push({id:'peek:blocked',missionId:m.id,tactic:'peek',strategy:'explore',description:'Action peek: survey blocked local geometry; retain '+m.kind+' mission '+m.id,waypoint:{...origin},lookAt:{...m.waypoint},fire:false,expiresTick:o.own.tick+PLAN_TICKS});
 return plans.slice(0,16);
}
