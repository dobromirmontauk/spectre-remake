import type { Obstacle, Vec2 } from '../sim/types.ts';
import { TANK_RADIUS } from '../config/constants.ts';
import { closestPointOnAABB, segmentVsAABB, segmentVsCircle } from '../sim/collision.ts';
import { distance } from './observation.ts';
function clearance(p:Vec2,o:Obstacle):number { return o.kind==='wall'?distance(p,closestPointOnAABB(p,o.min,o.max)):distance(p,o.position)-o.pylonRadius; }
// Existing safety-margin overlap permits only stationary or outward movement; hulls never cross geometry.
export function clearNavigationSegment(a:Vec2,b:Vec2,obstacles:Obstacle[],padding:number):boolean {
 return obstacles.every(o=>{
  const hit=o.kind==='wall'?segmentVsAABB(a,b,{x:o.min.x-padding,z:o.min.z-padding},{x:o.max.x+padding,z:o.max.z+padding}):segmentVsCircle(a,b,o.position,o.pylonRadius+padding);
  if(!hit.hit)return true;
  const before=clearance(a,o),after=clearance(b,o);
  if(before<TANK_RADIUS-1e-6||hit.t!==0||after+1e-8<before)return false;
  const physical=o.kind==='wall'?segmentVsAABB(a,b,{x:o.min.x-TANK_RADIUS,z:o.min.z-TANK_RADIUS},{x:o.max.x+TANK_RADIUS,z:o.max.z+TANK_RADIUS}):segmentVsCircle(a,b,o.position,o.pylonRadius+TANK_RADIUS);
  return !physical.hit||(physical.t===0&&before>=TANK_RADIUS-1e-6&&after>before);
 });
}
