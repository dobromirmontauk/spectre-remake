import type {TankObservation} from './types.ts';
import type {Vec2} from '../sim/types.ts';
import {segmentVsCircle} from '../sim/collision.ts';
import {TANK_RADIUS} from '../config/constants.ts';
import {BODY_SPACING,HOLD_ALLY_FRESH_TICKS} from './config.ts';
import {distance} from './observation.ts';
export function clearFriendlyRoute(o:TankObservation,a:Vec2,b:Vec2):boolean{
 return !o.contacts.some(c=>{
  if(c.kind!=='tank'||c.team!==o.own.team||c.id===o.own.id||c.seenTick>o.own.tick||o.own.tick-c.seenTick>HOLD_ALLY_FRESH_TICKS)return false;
  const start=distance(a,c.position),end=distance(b,c.position);
  if(start<BODY_SPACING)return end<start||segmentVsCircle(a,b,c.position,TANK_RADIUS*2).hit;
  return end<BODY_SPACING||segmentVsCircle(a,b,c.position,BODY_SPACING).hit;
 });
}
