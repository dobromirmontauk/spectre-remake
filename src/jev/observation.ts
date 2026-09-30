import type { GameState, TankState, Vec2, Obstacle } from '../sim/types.ts';
import { segmentVsAABB, segmentVsCircle } from '../sim/collision.ts';
import { datan2 } from '../sim/dmath.ts';
import { ARENA_HALF_SIZE } from '../config/constants.ts';
import { SIGHT_RANGE, SIGHT_HALF_ANGLE, MEMORY_TICKS } from './config.ts';
import type { Contact, TankMemory, TankObservation } from './types.ts';
export function findTank(state: GameState, id: string): TankState | undefined { return [...state.players, ...state.enemies].find(t => t.id === id); }
export function distance(a: Vec2,b: Vec2): number { return Math.sqrt((a.x-b.x)**2+(a.z-b.z)**2); }
export function angleDelta(a:number,b:number):number { let d=a-b; while(d>Math.PI)d-=2*Math.PI; while(d< -Math.PI)d+=2*Math.PI; return d; }
export function blocked(a:Vec2,b:Vec2,obstacles:Obstacle[],padding=0):boolean {
 return obstacles.some(o=>o.kind==='wall' ? segmentVsAABB(a,b,{x:o.min.x-padding,z:o.min.z-padding},{x:o.max.x+padding,z:o.max.z+padding}).hit : segmentVsCircle(a,b,o.position,o.pylonRadius+padding).hit);
}
export function observeTank(state: GameState, tankId:string, memory:TankMemory):TankObservation {
 const tank=findTank(state,tankId); if(!tank)throw new Error('Unknown tank');
 const team=state.players.some(p=>p.id===tankId)?'player':'enemy';
 const visible=(p:Vec2)=>distance(tank.position,p)<=SIGHT_RANGE && Math.abs(angleDelta(datan2(p.x-tank.position.x,p.z-tank.position.z),tank.heading))<=SIGHT_HALF_ANGLE && !blocked(tank.position,p,state.obstacles);
 const contacts:Contact[]=[];
 for(const t of [...state.players,...state.enemies])if(t.id!==tankId&&t.alive&&visible(t.position))contacts.push({id:t.id,kind:'tank',position:{...t.position},seenTick:state.tick,team:state.players.some(p=>p.id===t.id)?'player':'enemy'});
 for(const f of state.flags)if(!f.collected&&visible(f.position))contacts.push({id:f.id,kind:'flag',position:{...f.position},seenTick:state.tick});
 for(const p of state.pickups)if(!p.collected&&visible(p.position))contacts.push({id:p.id,kind:'pickup',pickupKind:p.kind,amount:p.amount,position:{...p.position},seenTick:state.tick});
 for(const [id,c] of Object.entries(memory.seen))if(c.kind!=='tank'&&visible(c.position)&&!contacts.some(v=>v.id===id))delete memory.seen[id];
 for(const c of contacts)memory.seen[c.id]={...c,position:{...c.position}};
 for(const [id,c]of Object.entries(memory.seen))if(state.tick-c.seenTick>MEMORY_TICKS)delete memory.seen[id];
 memory.visited??=[]; if(!memory.visited.some(p=>distance(p,tank.position)<10))memory.visited.push({...tank.position}); if(memory.visited.length>64)memory.visited.shift();
 // Only visible surfaces or four-unit tactile proximity enter commander knowledge.
 const geometry=state.obstacles.filter(o=>{
  const p=o.kind==='wall'?{x:Math.max(o.min.x,Math.min(o.max.x,tank.position.x)),z:Math.max(o.min.z,Math.min(o.max.z,tank.position.z))}:o.position;
  const d=distance(tank.position,p)-(o.kind==='windmill'?o.pylonRadius:0);
  if(d<4)return true;
  return d<=SIGHT_RANGE&&Math.abs(angleDelta(datan2(p.x-tank.position.x,p.z-tank.position.z),tank.heading))<=SIGHT_HALF_ANGLE&&!blocked(tank.position,p,state.obstacles.filter(other=>other.id!==o.id));
 }).map(o=>o.kind==='wall'?{...o,min:{...o.min},max:{...o.max}}:{...o,position:{...o.position}});

 return {visited:memory.visited.map(p=>({...p})),own:{id:tankId,team,position:{...tank.position},heading:tank.heading,speed:tank.speed,shieldFraction:tank.shield/tank.maxShield,ammo:tank.ammo,maxAmmo:tank.maxAmmo,shield:tank.shield,maxShield:tank.maxShield,fireReady:tank.fireCooldown===0,tick:state.tick},contacts,memory:Object.values(memory.seen).filter(c=>!contacts.some(v=>v.id===c.id)).map(c=>({...c,position:{...c.position}})),geometry,bounds:ARENA_HALF_SIZE};
}
