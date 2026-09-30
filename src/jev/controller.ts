import type { GameState, Vec2 } from '../sim/types.ts';
import type { Command } from '../sim/commands.ts';
import { dsin,dcos,datan2 } from '../sim/dmath.ts';
import { segmentVsCircle } from '../sim/collision.ts';
import { TANK_RADIUS, ARENA_HALF_SIZE } from '../config/constants.ts';
import { applyMovement } from '../sim/movement.ts';
import { movementParamsForEnemy } from '../sim/ai.ts';
import { levelConfig } from '../config/levels.ts';
import { findTank,distance,angleDelta,blocked } from './observation.ts';
import { PLAN_TICKS, SAFETY_MARGIN, LOOKAHEAD_SECONDS } from './config.ts';
import type { TankObservation,TacticalPlan } from './types.ts';
export function buildCandidates(o:TankObservation):TacticalPlan[] {
 const plans:TacticalPlan[]=[]; const origin=o.own.position;
 const add=(id:string,description:string,waypoint:Vec2,fire=false,targetId?:string)=>{if(Math.abs(waypoint.x)<o.bounds-4&&Math.abs(waypoint.z)<o.bounds-4&&!blocked(origin,waypoint,o.geometry,TANK_RADIUS+SAFETY_MARGIN))plans.push({id,description,waypoint,fire,targetId,expiresTick:o.own.tick+PLAN_TICKS});};
 for(const c of o.contacts){if(c.kind==='tank'&&c.team!==o.own.team){const d=distance(origin,c.position);const dx=(origin.x-c.position.x)/Math.max(d,1),dz=(origin.z-c.position.z)/Math.max(d,1);add('engage:'+c.id,'Engage visible target '+c.id+' while maintaining separation',{x:c.position.x+dx*12,z:c.position.z+dz*12},true,c.id);for(const s of [-1,1])add('flank:'+c.id+':'+s,'Flank visible target '+c.id,{x:c.position.x+dx*18-dz*s*14,z:c.position.z+dz*18+dx*s*14},true,c.id);add('retreat:'+c.id,'Create distance from visible target '+c.id,{x:origin.x+dx*15,z:origin.z+dz*15},true,c.id);}else if(c.kind==='flag'&&o.own.team==='player')add('flag:'+c.id,'Collect visible flag '+c.id,c.position);else if(c.kind==='pickup'&&o.own.team==='player')add('pickup:'+c.id,'Collect visible supply '+c.id,c.position);}
 for(const c of o.memory)if(c.kind!=='tank')add('remember:'+c.id,'Navigate to previously seen '+c.kind,c.position);
 // Sector sweep keeps tanks moving/searching without obtaining hidden coordinates.
 for(let i=0;i<8;i++){const a=o.own.heading+i*Math.PI/4;const p={x:origin.x+dsin(a)*24,z:origin.z+dcos(a)*24};if(!o.visited.some(v=>distance(v,p)<12))add('explore:'+i,'Search unvisited clear sector '+i+' for flags or opponents',p);}
 if(!plans.length)for(let i=0;i<8;i++){const a=o.own.heading+i*Math.PI/4;add('revisit:'+i,'Navigate clear sector to exit surveyed area',{x:origin.x+dsin(a)*15,z:origin.z+dcos(a)*15});}
 if(!plans.length)plans.push({id:'scan',description:'Rotate to survey blocked surroundings',waypoint:origin,fire:false,expiresTick:o.own.tick+PLAN_TICKS});return plans;
}
export interface SafetyDiagnostics { wallAvoided:number; tankAvoided:number; allyShotAvoided:number }
export function commandForPlan(state:GameState,tankId:string,plan:TacticalPlan|null,diagnostics?:SafetyDiagnostics):Command {
 const tank=findTank(state,tankId);const neutral:Command={turn:0,thrust:0,fire:false,grenade:false};if(!tank||!tank.alive)return neutral;
 if(!plan||plan.expiresTick<state.tick)return {...neutral,turn:1};
 const player=state.players.find(p=>p.id===tankId);const enemy=state.enemies.find(e=>e.id===tankId);const params=player?.movement??movementParamsForEnemy(enemy!.kind,levelConfig(state.level));
 const target=plan.targetId?findTank(state,plan.targetId):undefined;
 // Firing is recomputed from local sight; never follow an unseen target's new position.
 const visibleTarget=target?.alive&&distance(tank.position,target.position)<65&&!blocked(tank.position,target.position,state.obstacles)&&Math.abs(angleDelta(datan2(target.position.x-tank.position.x,target.position.z-tank.position.z),tank.heading))<Math.PI*.65?target:undefined;
 const waypoint=plan.waypoint;const d=distance(tank.position,waypoint);const aim=datan2(waypoint.x-tank.position.x,waypoint.z-tank.position.z);let delta=angleDelta(aim,tank.heading);
 if(d<3&&visibleTarget)delta=angleDelta(datan2(visibleTarget.position.x-tank.position.x,visibleTarget.position.z-tank.position.z),tank.heading);
 let turn:Command['turn']=Math.abs(delta)<.045?0:delta>0?1:-1;
 let thrust:Command['thrust']=d>3&&Math.abs(delta)<.7?1:0;
 const all=[...state.players,...state.enemies];
 const safe=(cmd:Command)=>{const ghost={...tank,position:{...tank.position},prevPosition:{...tank.prevPosition}};for(let i=0;i<Math.ceil(LOOKAHEAD_SECONDS*30);i++){const before={...ghost.position};applyMovement(ghost,cmd,params);if(Math.abs(ghost.position.x)>ARENA_HALF_SIZE-TANK_RADIUS-SAFETY_MARGIN||Math.abs(ghost.position.z)>ARENA_HALF_SIZE-TANK_RADIUS-SAFETY_MARGIN||blocked(before,ghost.position,state.obstacles,TANK_RADIUS+SAFETY_MARGIN)||all.some(t=>t.id!==tankId&&t.alive&&segmentVsCircle(before,ghost.position,t.position,TANK_RADIUS*2+SAFETY_MARGIN).hit))return false;}return true;};
 if(!safe({turn,thrust,fire:false,grenade:false})){if(diagnostics){const end={x:tank.position.x+dsin(tank.heading)*Math.max(4,Math.abs(tank.speed)*LOOKAHEAD_SECONDS),z:tank.position.z+dcos(tank.heading)*Math.max(4,Math.abs(tank.speed)*LOOKAHEAD_SECONDS)};if(all.some(t=>t.id!==tankId&&t.alive&&segmentVsCircle(tank.position,end,t.position,TANK_RADIUS*2+SAFETY_MARGIN).hit))diagnostics.tankAvoided++;else diagnostics.wallAvoided++;}thrust=-1;if(!safe({turn,thrust,fire:false,grenade:false})){thrust=0;turn=turn||1;}}
 let fire=false;if(plan.fire&&visibleTarget&&Math.abs(angleDelta(datan2(visibleTarget.position.x-tank.position.x,visibleTarget.position.z-tank.position.z),tank.heading))<.08){const end=visibleTarget.position;const allies=player?state.players:state.enemies;fire=!allies.some(t=>t.id!==tankId&&t.alive&&segmentVsCircle(tank.position,end,t.position,TANK_RADIUS+1).hit);}
 if(plan.fire&&visibleTarget&&!fire&&diagnostics&&Math.abs(angleDelta(datan2(visibleTarget.position.x-tank.position.x,visibleTarget.position.z-tank.position.z),tank.heading))<.08)diagnostics.allyShotAvoided++;
 return {turn,thrust,fire,grenade:false};
}
