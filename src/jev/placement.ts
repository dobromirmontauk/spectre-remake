import type { GameState, Vec2 } from '../sim/types.ts';
import { ARENA_HALF_SIZE, TANK_RADIUS } from '../config/constants.ts';
import { blocked, distance } from './observation.ts';
import { SAFETY_MARGIN } from './config.ts';
// Called only for newly spawned Jev-controlled hulls, never ordinary simulation ticks.
export function separateJevSpawns(state:GameState,spawnedIds:string[]):void {
 const all=[...state.players,...state.enemies].filter(t=>t.alive);
 const valid=(id:string,p:Vec2)=>Math.abs(p.x)<ARENA_HALF_SIZE-TANK_RADIUS-SAFETY_MARGIN&&Math.abs(p.z)<ARENA_HALF_SIZE-TANK_RADIUS-SAFETY_MARGIN&&!blocked(p,p,state.obstacles,TANK_RADIUS+SAFETY_MARGIN)&&all.every(t=>t.id===id||distance(p,t.position)>=6.5);
 for(const id of spawnedIds){const tank=state.enemies.find(e=>e.id===id&&e.alive);if(!tank||valid(id,tank.position))continue;
  const start={...tank.position};let placed=false;
  // Near-spawn grid search is deterministic and does not consume normal-world RNG.
  for(let ring=1;ring<=25&&!placed;ring++)for(let dz=-ring;dz<=ring&&!placed;dz++)for(let dx=-ring;dx<=ring&&!placed;dx++){
   if(Math.abs(dx)!==ring&&Math.abs(dz)!==ring)continue;
   const point={x:start.x+dx*4,z:start.z+dz*4};if(!valid(id,point))continue;
   tank.position={...point};tank.prevPosition={...point};placed=true;
  }
 }
}
