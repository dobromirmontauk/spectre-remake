import type { GameState, TankState, Vec2, Obstacle } from '../sim/types.ts';
import { segmentVsAABB, segmentVsCircle } from '../sim/collision.ts';
import { datan2, dsin as dsinForThreat, dcos as dcosForThreat } from '../sim/dmath.ts';
import { ARENA_HALF_SIZE } from '../config/constants.ts';
import { SIGHT_RANGE, SIGHT_HALF_ANGLE, MEMORY_TICKS } from './config.ts';
import type { Contact, TankMemory, TankObservation, ObservationContext } from './types.ts';
export function findTank(state: GameState, id: string): TankState | undefined { return [...state.players, ...state.enemies].find(t => t.id === id); }
export function distance(a: Vec2,b: Vec2): number { return Math.sqrt((a.x-b.x)**2+(a.z-b.z)**2); }
export function angleDelta(a:number,b:number):number { let d=a-b; while(d>Math.PI)d-=2*Math.PI; while(d< -Math.PI)d+=2*Math.PI; return d; }
export function blocked(a:Vec2,b:Vec2,obstacles:Obstacle[],padding=0):boolean {
 return obstacles.some(o=>o.kind==='wall' ? segmentVsAABB(a,b,{x:o.min.x-padding,z:o.min.z-padding},{x:o.max.x+padding,z:o.max.z+padding}).hit : segmentVsCircle(a,b,o.position,o.pylonRadius+padding).hit);
}
export function observeTank(state: GameState, tankId:string, memory:TankMemory, context:ObservationContext = {}):TankObservation {
 const tank=findTank(state,tankId); if(!tank)throw new Error('Unknown tank');
 const team=state.players.some(p=>p.id===tankId)?'player':'enemy';
 const position=(p:Vec2):Vec2=>state.level>=3?{...p}:{x:Math.round(p.x/10)*10,z:Math.round(p.z/10)*10};
 const visible=(p:Vec2)=>distance(tank.position,p)<=SIGHT_RANGE && Math.abs(angleDelta(datan2(p.x-tank.position.x,p.z-tank.position.z),tank.heading))<=SIGHT_HALF_ANGLE && !blocked(tank.position,p,state.obstacles);
 const stamp=(c:Contact):Contact=>({...c,position:{...c.position},seenSeconds:c.seenTick/30,ageSeconds:Math.max(0,(state.tick-c.seenTick)/30)});
 const contacts:Contact[]=[];
 for(const t of [...state.players,...state.enemies])if(t.id!==tankId&&t.alive&&visible(t.position))contacts.push({id:t.id,kind:'tank',position:{...t.position},heading:t.heading,seenTick:state.tick,source:'own',team:state.players.some(p=>p.id===t.id)?'player':'enemy'});
 for(const f of state.flags)if(!f.collected&&(state.level>=3||visible(f.position)))contacts.push({id:f.id,kind:'flag',position:position(f.position),seenTick:state.tick,source:state.level>=3?'map':'own'});
 for(const p of state.pickups)if(!p.collected&&(state.level>=3||visible(p.position)))contacts.push({id:p.id,kind:'pickup',pickupKind:p.kind,amount:p.amount,position:position(p.position),seenTick:state.tick,source:state.level>=3?'map':'own'});
 memory.seenPositions??={};
 for(const [id,c] of Object.entries(memory.seen))if(c.kind!=='tank'&&(state.level>=3||visible(memory.seenPositions[id]??c.position))&&!contacts.some(v=>v.id===id)){delete memory.seen[id];delete memory.seenPositions[id];}
 for(const f of state.flags)if(!f.collected&&visible(f.position))memory.seenPositions[f.id]={...f.position};
 for(const p of state.pickups)if(!p.collected&&visible(p.position))memory.seenPositions[p.id]={...p.position};
 for(const c of contacts)memory.seen[c.id]={...c,position:{...c.position}};
 // Level5 enemy squad telemetry knows its own members; player sightings require an actual reporter.
 if(state.level>=5){
  for(const ally of state.enemies)if(ally.id!==tankId&&ally.alive&&!contacts.some(c=>c.id===ally.id))contacts.push({id:ally.id,kind:'tank',team:'enemy',position:{...ally.position},heading:ally.heading,seenTick:state.tick,source:'shared',strategy:context.strategies?.[ally.id]});
  for(const c of contacts)if(c.team==='enemy'){c.strategy=context.strategies?.[c.id];if(c.source==='own')memory.seen[c.id]={...c,position:{...c.position}};}
  for(const report of team==='enemy'?context.sharedSightings??[]:[]){
   if(report.kind!=='tank'||report.team!=='player'||report.id===tankId||report.seenTick>state.tick||state.tick-report.seenTick>MEMORY_TICKS||contacts.some(c=>c.id===report.id))continue;
   const shared={...report,source:'shared' as const,position:{...report.position}};
   // Preserve report time and heading, never reconstruct hidden current state.
   if(report.seenTick===state.tick)contacts.push(shared);
   const old=memory.seen[shared.id];if(!old||old.seenTick<shared.seenTick)memory.seen[shared.id]=shared;
  }
 }
 for(const [id,c]of Object.entries(memory.seen))if(c.kind==='tank'&&state.tick-c.seenTick>MEMORY_TICKS)delete memory.seen[id];
 if(memory.lastShield!==undefined&&tank.shield<memory.lastShield)memory.recentThreat={kind:'damage',tick:state.tick,seconds:state.tick/30,ageSeconds:0};
 memory.lastShield=tank.shield;
 for(const shot of state.projectiles)if(shot.ownerId!==tankId&&visible(shot.position)&&distance(tank.position,shot.position)<25){
  const dx=tank.position.x-shot.position.x,dz=tank.position.z-shot.position.z;
  // Only visibly approaching shots imply a threat; owner hidden coordinates/health are never read.
  if(dx*dsinForThreat(shot.heading)+dz*dcosForThreat(shot.heading)>0)memory.recentThreat={kind:'projectile',tick:state.tick,seconds:state.tick/30,ageSeconds:0,direction:{x:-dx,z:-dz}};
 }
 memory.visited??=[];if(!memory.visited.some(p=>distance(p,tank.position)<10))memory.visited.push(position(tank.position));if(memory.visited.length>64)memory.visited.shift();
 const geometry=state.obstacles.filter(o=>{
  const p=o.kind==='wall'?{x:Math.max(o.min.x,Math.min(o.max.x,tank.position.x)),z:Math.max(o.min.z,Math.min(o.max.z,tank.position.z))}:o.position;
  const d=distance(tank.position,p)-(o.kind==='windmill'?o.pylonRadius:0);
  return d<4||(d<=SIGHT_RANGE&&Math.abs(angleDelta(datan2(p.x-tank.position.x,p.z-tank.position.z),tank.heading))<=SIGHT_HALF_ANGLE&&!blocked(tank.position,p,state.obstacles.filter(other=>other.id!==o.id)));
 }).map(o=>o.kind==='wall'?{...o,min:{...o.min},max:{...o.max}}:{...o,position:{...o.position}});
 const recentThreat=memory.recentThreat&&state.tick-memory.recentThreat.tick<=90?{...memory.recentThreat,ageSeconds:(state.tick-memory.recentThreat.tick)/30}:undefined;
 return {remainingFlags:state.flags.filter(f=>!f.collected).length,totalFlags:state.flags.length,level:state.level,nowSeconds:state.tick/30,recentThreat,visited:memory.visited.slice(-8).map(p=>({...p})),own:{id:tankId,team,position:position(tank.position),heading:tank.heading,speed:tank.speed,shieldFraction:tank.shield/tank.maxShield,ammo:tank.ammo,maxAmmo:tank.maxAmmo,shield:tank.shield,maxShield:tank.maxShield,fireReady:tank.fireCooldown===0,tick:state.tick,lastStrategy:context.strategies?.[tankId]},contacts:contacts.map(stamp),memory:Object.values(memory.seen).filter(c=>!contacts.some(v=>v.id===c.id)).map(stamp),geometry,bounds:ARENA_HALF_SIZE};
}
