import type { GameState, Vec2 } from '../sim/types.ts';
import type { Command } from '../sim/commands.ts';
import { dsin,dcos,datan2 } from '../sim/dmath.ts';
import { segmentVsCircle, segmentVsAABB } from '../sim/collision.ts';
import { TANK_RADIUS, ARENA_HALF_SIZE, PROJECTILE_RANGE, PROJECTILE_RADIUS } from '../config/constants.ts';
import { applyMovement } from '../sim/movement.ts';
import { movementParamsForEnemy } from '../sim/ai.ts';
import { levelConfig } from '../config/levels.ts';
import { findTank,distance,angleDelta,blocked } from './observation.ts';
import { PLAN_TICKS, SAFETY_MARGIN, LOOKAHEAD_SECONDS } from './config.ts';
import type { TankObservation,TacticalPlan,Strategy } from './types.ts';
export function buildCandidates(o:TankObservation):TacticalPlan[] {
 const plans:TacticalPlan[]=[]; const origin=o.own.position;
 const survival=!!o.recentThreat||o.own.shieldFraction<.35;
 const strategyFor=(id:string):Strategy=>id.startsWith('retreat:')?'retreat':id.startsWith('regroup:')?'regroup':id.startsWith('patrol:')?'patrol':id.startsWith('guard:')||id.startsWith('hold:')?'protect':id.startsWith('engage:')||id.startsWith('flank:')?'pursue':'explore';
 const add=(id:string,description:string,waypoint:Vec2,fire=false,targetId?:string)=>{if(Math.abs(waypoint.x)<o.bounds-4&&Math.abs(waypoint.z)<o.bounds-4&&!blocked(origin,waypoint,o.geometry,TANK_RADIUS+SAFETY_MARGIN))plans.push({id,strategy:strategyFor(id),description:'Strategy '+strategyFor(id)+': '+description+'; travel '+Math.round(distance(origin,waypoint))+' units at '+Math.round(angleDelta(datan2(waypoint.x-origin.x,waypoint.z-origin.z),o.own.heading)*180/Math.PI)+' degrees relative heading; known obstacle route clear'+(targetId?'; destination target range '+Math.round(distance(waypoint,o.contacts.find(c=>c.id===targetId)!.position))+' units':''),waypoint,fire,targetId,expiresTick:o.own.tick+PLAN_TICKS});};
 const supply=(c:TankObservation['contacts'][number],remembered=false)=>{
  if(o.own.team!=='player'||!c.pickupKind||!c.amount)return;
  const missing=c.pickupKind==='shield'?o.own.maxShield-o.own.shield:o.own.maxAmmo-o.own.ammo;
  const benefit=Math.min(c.amount,missing);if(benefit<=0)return;
  add((remembered?'remember:':'pickup:')+c.id,'Collect '+(remembered?'previously seen':'visible')+' '+c.pickupKind+' supply '+c.id+'; restore up to '+benefit+' '+c.pickupKind+' of '+missing+' missing; '+(c.pickupKind==='shield'?'improve survival':'enable more cannon shots'),c.position);
 };
 for(const c of o.contacts){if(c.kind==='tank'&&c.team!==o.own.team){const d=distance(origin,c.position);const dx=(origin.x-c.position.x)/Math.max(d,1),dz=(origin.z-c.position.z)/Math.max(d,1);add('hold:'+c.id,'Hold current vantage, aim and fire at visible target '+c.id,origin,true,c.id);add('engage:'+c.id,'Engage visible target '+c.id+' while maintaining separation',{x:c.position.x+dx*12,z:c.position.z+dz*12},true,c.id);for(const s of [-1,1])add('flank:'+c.id+':'+s,'Flank '+(s===1?'left':'right')+' of visible target '+c.id,{x:c.position.x+dx*18-dz*s*14,z:c.position.z+dz*18+dx*s*14},true,c.id);add('retreat:'+c.id,'Create distance from visible target '+c.id,{x:origin.x+dx*15,z:origin.z+dz*15},true,c.id);}else if(c.kind==='flag'&&o.own.team==='player')add('flag:'+c.id,'Collect visible flag '+c.id,c.position);else if(c.kind==='pickup')supply(c);}
 for(const c of o.memory)if(o.own.team==='player'){if(c.kind==='flag')add('remember:'+c.id,'Collect previously seen flag '+c.id,c.position);else if(c.kind==='pickup')supply(c,true);}
 if(o.own.team==='enemy'&&!o.contacts.some(c=>c.kind==='tank'&&c.team!==o.own.team))for(const c of [...o.contacts,...o.memory])if(c.kind==='flag'){
  const gap=Math.max(1,distance(origin,c.position));
  add('guard:'+c.id,'Guard '+(c.seenTick===o.own.tick?'visible':'previously seen')+' flag '+c.id+' from a12-unit stand-off vantage; watch for approaching opposing player, do not collect',{x:c.position.x+(origin.x-c.position.x)*12/gap,z:c.position.z+(origin.z-c.position.z)*12/gap});
  const guard=plans.find(p=>p.id==='guard:'+c.id);if(guard)guard.lookAt={...c.position};
 }

 const opponents=o.contacts.filter(c=>c.kind==='tank'&&c.team!==o.own.team);
 const knownFlags=[...o.contacts,...o.memory].filter(c=>c.kind==='flag').sort((a,b)=>distance(origin,a.position)-distance(origin,b.position));
 if(!opponents.length&&o.own.team==='enemy')for(const flag of knownFlags.slice(0,2)){
  const bearing=datan2(origin.x-flag.position.x,origin.z-flag.position.z);
  for(const direction of [1,-1]){
   const a=bearing+direction*Math.PI/4;
   add('patrol:'+flag.id+':'+direction,'Circle '+(direction===1?'clockwise':'counterclockwise')+' around known flag '+flag.id+' at18-unit radius; continuously survey for opponents',{x:flag.position.x+dsin(a)*18,z:flag.position.z+dcos(a)*18});
   if(plans.some(p=>p.id==='patrol:'+flag.id+':'+direction))break; // Stable clockwise patrol; counterclockwise only if its next segment is blocked.
  }
 }
 // Survival uses only visible/reportable threats and own recent damage, never hidden attackers.
 if(survival){
  let ax=0,az=0;
  for(const c of opponents){const gap=Math.max(1,distance(origin,c.position));ax+=(origin.x-c.position.x)/gap;az+=(origin.z-c.position.z)/gap;}
  if(o.recentThreat?.direction){ax-=o.recentThreat.direction.x;az-=o.recentThreat.direction.z;}
  if(Math.abs(ax)+Math.abs(az)<.01){ax=-dsin(o.own.heading);az=-dcos(o.own.heading);}
  const away=datan2(ax,az);
  for(const [sector,offset] of [0,-Math.PI/4,Math.PI/4].entries())add('retreat:safe:'+sector,'Break contact after '+(o.recentThreat?.kind??'low shields')+'; move away and regain stopping room',{x:origin.x+dsin(away+offset)*18,z:origin.z+dcos(away+offset)*18},opponents.length>0,opponents[0]?.id);
 }
 for(const ally of o.contacts.filter(c=>c.kind==='tank'&&c.team===o.own.team)){
  const gap=Math.max(1,distance(origin,ally.position));
  add('regroup:'+ally.id,'Regroup8 units from known ally '+ally.id+'; coordinate with ally strategy '+(ally.strategy??'unknown')+' without colliding',{x:ally.position.x+(origin.x-ally.position.x)*8/gap,z:ally.position.z+(origin.z-ally.position.z)*8/gap},opponents.length>0,opponents[0]?.id);
 }
 // Sector sweep keeps tanks moving/searching without obtaining hidden coordinates.
 for(let i=0;i<8;i++){const a=o.own.heading+i*Math.PI/4;const p={x:origin.x+dsin(a)*24,z:origin.z+dcos(a)*24};if(!o.visited.some(v=>distance(v,p)<12))add('explore:'+i,'Search unvisited clear sector '+i+(o.own.team==='player'?' for flags, supplies or opponents':' for opposing player; reacquire visual contact'),p);}
 if(!plans.length)for(let i=0;i<8;i++){const a=o.own.heading+i*Math.PI/4;add('revisit:'+i,'Navigate clear sector to exit surveyed area',{x:origin.x+dsin(a)*15,z:origin.z+dcos(a)*15});}
 if(!plans.length)plans.push({id:'scan',description:'Rotate to survey blocked surroundings',waypoint:origin,fire:false,expiresTick:o.own.tick+PLAN_TICKS});const priority=(p:TacticalPlan)=>survival?(p.strategy==='retreat'?0:p.strategy==='regroup'?1:p.description.includes('shield supply')?2:p.strategy==='explore'?3:4):p.strategy==='patrol'?0:o.own.team==='player'&&p.id.startsWith('flag:')?0:p.strategy==='pursue'||p.strategy==='protect'?1:2;
 plans.sort((a,b)=>priority(a)-priority(b));
 // While frightened, withhold offensive pursuit/hold choices; deterministic reflex still handles collisions.
 const recovery=plans.filter(p=>p.strategy==='retreat'||p.strategy==='regroup'||p.description.includes('shield supply'));
 const allowed=survival&&recovery.length?recovery:survival?plans.filter(p=>p.strategy!=='pursue'&&p.strategy!=='protect'):plans;
 return (allowed.length?allowed:plans).slice(0,16);
}
export interface SafetyDiagnostics { wallAvoided:number; tankAvoided:number; allyShotAvoided:number }
export function commandForPlan(state:GameState,tankId:string,plan:TacticalPlan|null,diagnostics?:SafetyDiagnostics):Command {
 const tank=findTank(state,tankId);const neutral:Command={turn:0,thrust:0,fire:false,grenade:false};if(!tank||!tank.alive)return neutral;
 const missingPlan=!plan||plan.expiresTick<state.tick;
 if(missingPlan)plan={id:'timeout-scan',description:'Locally brake/coast then survey',waypoint:{...tank.position},fire:false,expiresTick:state.tick};
 // Always run prediction even while the provider is unavailable.
 if(!plan)return neutral;
 const player=state.players.find(p=>p.id===tankId);const enemy=state.enemies.find(e=>e.id===tankId);const params=player?.movement??movementParamsForEnemy(enemy!.kind,levelConfig(state.level));
 const target=plan.targetId?findTank(state,plan.targetId):undefined;
 // Firing is recomputed from local sight; never follow an unseen target's new position.
 const visibleTarget=target?.alive&&distance(tank.position,target.position)<65&&!blocked(tank.position,target.position,state.obstacles)&&Math.abs(angleDelta(datan2(target.position.x-tank.position.x,target.position.z-tank.position.z),tank.heading))<Math.PI*.65?target:undefined;
 const waypoint=plan.waypoint;const d=distance(tank.position,waypoint);const aim=datan2(waypoint.x-tank.position.x,waypoint.z-tank.position.z);let delta=angleDelta(aim,tank.heading);
 if(d<3&&visibleTarget)delta=angleDelta(datan2(visibleTarget.position.x-tank.position.x,visibleTarget.position.z-tank.position.z),tank.heading);
 else if(d<3&&plan.strategy==='patrol')delta=.2;
 else if(d<3&&plan.lookAt)delta=angleDelta(datan2(plan.lookAt.x-tank.position.x,plan.lookAt.z-tank.position.z),tank.heading);
 let turn:Command['turn']=Math.abs(delta)<.045?0:delta>0?1:-1;
 let thrust:Command['thrust']=d>3&&Math.abs(delta)<.7?1:0;
 if(missingPlan){turn=Math.abs(tank.speed)<.1?1:0;thrust=0;}
 const all=[...state.players,...state.enemies];
 // Tactile spacing reflex: move away from close hulls instead of accepting mutual idle.
 const nearby=all.filter(t=>{
 if(t.id===tankId||!t.alive)return false;
 const rx=t.position.x-tank.position.x,rz=t.position.z-tank.position.z;
 const vx=dsin(t.heading)*t.speed-dsin(tank.heading)*tank.speed,vz=dcos(t.heading)*t.speed-dcos(tank.heading)*tank.speed;
 const relativeSpeedSquared=vx*vx+vz*vz;const closing=rx*vx+rz*vz;
 const time=relativeSpeedSquared>.01?Math.max(0,Math.min(2,-closing/relativeSpeedSquared)):0;
 const closest=Math.sqrt((rx+vx*time)**2+(rz+vz*time)**2);
 return distance(tank.position,t.position)<6.5||(closing<0&&closest<6.5&&time>0);
 });
 if(nearby.length){
  let awayX=0,awayZ=0;for(const other of nearby){const gap=Math.max(.1,distance(tank.position,other.position));awayX+=(tank.position.x-other.position.x)/(gap*gap);awayZ+=(tank.position.z-other.position.z)/(gap*gap);}
  const away=datan2(awayX,awayZ);const forwardDelta=angleDelta(away,tank.heading);const reverseDelta=angleDelta(away+Math.PI,tank.heading);
  const reversing=Math.abs(reverseDelta)<Math.abs(forwardDelta);const steering=reversing?reverseDelta:forwardDelta;
  turn=Math.abs(steering)<.045?0:steering>0?1:-1;thrust=Math.abs(steering)<.7?(reversing?-1:1):0;
 }
 // Arena geometry is public local safety knowledge; step inward before the edge can trap a hull.
 const edgeX=Math.abs(tank.position.x)>96||(Math.abs(tank.position.x)>90&&Math.abs(plan.waypoint.x)>96);
 const edgeZ=Math.abs(tank.position.z)>96||(Math.abs(tank.position.z)>90&&Math.abs(plan.waypoint.z)>96);
 if(edgeX||edgeZ){
  const inward=datan2(edgeX?-Math.sign(tank.position.x):0,edgeZ?-Math.sign(tank.position.z):0);
  const forward=angleDelta(inward,tank.heading),reverse=angleDelta(inward+Math.PI,tank.heading);
  const backing=Math.abs(reverse)<Math.abs(forward);const steering=backing?reverse:forward;
  turn=Math.abs(steering)<.045?0:steering>0?1:-1;thrust=Math.abs(steering)<.7?(backing?-1:1):0;
 }
 const withinBounds=(a:Vec2,b:Vec2,margin=SAFETY_MARGIN)=>{
  const physical=ARENA_HALF_SIZE-TANK_RADIUS,clearance=physical-margin;
  if(Math.abs(b.x)>physical+1e-8||Math.abs(b.z)>physical+1e-8)return false;
  return (Math.abs(a.x)>clearance?Math.abs(b.x)<=Math.abs(a.x)+1e-8:Math.abs(b.x)<=clearance)&&(Math.abs(a.z)>clearance?Math.abs(b.z)<=Math.abs(a.z)+1e-8:Math.abs(b.z)<=clearance);
 };
 const safe=(cmd:Command)=>{const ghost={...tank,position:{...tank.position},prevPosition:{...tank.prevPosition}};const horizon=Math.ceil(LOOKAHEAD_SECONDS*30);for(let i=0;i<horizon+300;i++){if(i>=horizon&&Math.abs(ghost.speed)<.001)break;const before={...ghost.position};applyMovement(ghost,i<horizon?cmd:{...cmd,thrust:0},params);if(!withinBounds(before,ghost.position)||blocked(before,ghost.position,state.obstacles,TANK_RADIUS+SAFETY_MARGIN)||all.some(t=>{
 if(t.id===tankId||!t.alive)return false;
 const physical=TANK_RADIUS*2;const clearance=physical+SAFETY_MARGIN;
 // Relative swept segment predicts observed heading/speed rather than a stationary hull.
 const seconds=i/30,nextSeconds=(i+1)/30;
 const velocity={x:dsin(t.heading)*t.speed,z:dcos(t.heading)*t.speed};
 const relativeBefore={x:before.x-velocity.x*seconds,z:before.z-velocity.z*seconds};
 const relativeAfter={x:ghost.position.x-velocity.x*nextSeconds,z:ghost.position.z-velocity.z*nextSeconds};
 if(distance(relativeBefore,t.position)<clearance){
  // An existing clearance overlap may only stay still or increase distance; hull intersection is always forbidden.
  const startGap=distance(relativeBefore,t.position),endGap=distance(relativeAfter,t.position);
  if(endGap+1e-8<startGap)return true;
  const hullHit=segmentVsCircle(relativeBefore,relativeAfter,t.position,physical);
  // Numerical boundary-touch is safe only when the sweep immediately separates.
  return hullHit.hit&&!(hullHit.t===0&&startGap>=physical-1e-6&&endGap>startGap);
 }
 return segmentVsCircle(relativeBefore,relativeAfter,t.position,clearance).hit;
}))return false;}return true;};
 // Every accepted next tick must retain a straight-heading emergency stopping corridor.
 // Future model replans can change turning, so a curved coast rollout alone is insufficient.
 const stoppingRoom=(cmd:Command)=>{
  const ghost={...tank,position:{...tank.position},prevPosition:{...tank.prevPosition}};
  const staticSafe=(a:Vec2,b:Vec2)=>withinBounds(a,b)&&!blocked(a,b,state.obstacles,TANK_RADIUS+SAFETY_MARGIN);
  let before={...ghost.position};applyMovement(ghost,cmd,params);if(!staticSafe(before,ghost.position))return false;
  for(let i=0;i<300&&Math.abs(ghost.speed)>.001;i++){
   before={...ghost.position};const previousSpeed=ghost.speed;
   applyMovement(ghost,{turn:0,thrust:Math.abs(previousSpeed)<=(previousSpeed<0?params.thrustAccel:params.reverseAccel)/30?0:previousSpeed<0?1:-1,fire:false,grenade:false},params);
   if(!staticSafe(before,ghost.position))return false;
   if(previousSpeed*ghost.speed<=0)break;
  }
  return true;
 };
 if(!safe({turn,thrust,fire:false,grenade:false})||!stoppingRoom({turn,thrust,fire:false,grenade:false})){if(diagnostics){const end={x:tank.position.x+dsin(tank.heading)*Math.max(4,Math.abs(tank.speed)*LOOKAHEAD_SECONDS),z:tank.position.z+dcos(tank.heading)*Math.max(4,Math.abs(tank.speed)*LOOKAHEAD_SECONDS)};if(all.some(t=>t.id!==tankId&&t.alive&&segmentVsCircle(tank.position,end,t.position,TANK_RADIUS*2+SAFETY_MARGIN).hit))diagnostics.tankAvoided++;else diagnostics.wallAvoided++;}thrust=tank.speed<0?1:-1;
 const turns:Command['turn'][]=[turn,0,turn===1?-1:1];
 let feasible=false;
 for(const emergencyTurn of turns){const braking:Command={turn:emergencyTurn,thrust,fire:false,grenade:false};if(stoppingRoom(braking)&&safe(braking)){turn=emergencyTurn;feasible=true;break;}}
 if(!feasible){
  // Recover a collapsed margin with a physically feasible curved emergency stop.
  const canEmergencyStop=(emergencyTurn:Command['turn'])=>{
   const ghost={...tank,position:{...tank.position},prevPosition:{...tank.prevPosition}};
   for(let i=0;i<300&&Math.abs(ghost.speed)>.001;i++){
    const before={...ghost.position},v=ghost.speed;
    applyMovement(ghost,{turn:emergencyTurn,thrust:Math.abs(v)<=(v<0?params.thrustAccel:params.reverseAccel)/30?0:v<0?1:-1,fire:false,grenade:false},params);
    if(!withinBounds(before,ghost.position,0)||blocked(before,ghost.position,state.obstacles,TANK_RADIUS+.05))return false;
    if(v*ghost.speed<=0)break;
   }
   return true;
  };
  turn=0;for(const recoveryTurn of [0,-1,1] as const)if(canEmergencyStop(recoveryTurn)){turn=recoveryTurn;break;}
  if(Math.abs(tank.speed)<.1){thrust=0;turn=1;}
 }
 }

 let fire=false;if(plan.fire&&visibleTarget&&Math.abs(angleDelta(datan2(visibleTarget.position.x-tank.position.x,visibleTarget.position.z-tank.position.z),tank.heading))<.08){const end={x:tank.position.x+dsin(tank.heading)*PROJECTILE_RANGE,z:tank.position.z+dcos(tank.heading)*PROJECTILE_RANGE};
 const targetHit=segmentVsCircle(tank.position,end,visibleTarget.position,TANK_RADIUS+PROJECTILE_RADIUS);
 let impact=targetHit.hit?targetHit.t:1;
 for(const obstacle of state.obstacles){const hit=obstacle.kind==='wall'?segmentVsAABB(tank.position,end,{x:obstacle.min.x-PROJECTILE_RADIUS,z:obstacle.min.z-PROJECTILE_RADIUS},{x:obstacle.max.x+PROJECTILE_RADIUS,z:obstacle.max.z+PROJECTILE_RADIUS}):segmentVsCircle(tank.position,end,obstacle.position,obstacle.pylonRadius+PROJECTILE_RADIUS);if(hit.hit)impact=Math.min(impact,hit.t);}
 const allies=player?state.players:state.enemies;fire=targetHit.hit&&!allies.some(t=>{if(t.id===tankId||!t.alive)return false;const hit=segmentVsCircle(tank.position,end,t.position,TANK_RADIUS+PROJECTILE_RADIUS+SAFETY_MARGIN);return hit.hit&&hit.t<=impact;});}
 if(plan.fire&&visibleTarget&&!fire&&diagnostics&&Math.abs(angleDelta(datan2(visibleTarget.position.x-tank.position.x,visibleTarget.position.z-tank.position.z),tank.heading))<.08)diagnostics.allyShotAvoided++;
 return {turn,thrust,fire,grenade:false};
}
