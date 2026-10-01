import type {Contact,SquadMission,TankObservation} from './types.ts';
import {distance} from './observation.ts';
import {dsin,dcos,datan2} from '../sim/dmath.ts';
import {SQUAD_REVIEW_TICKS,SQUAD_CONTACT_HYSTERESIS_TICKS,SQUAD_HUNT_MAX_TICKS} from './config.ts';
const sectors=[{x:-60,z:-60},{x:0,z:-60},{x:60,z:-60},{x:60,z:0},{x:60,z:60},{x:0,z:60},{x:-60,z:60},{x:-60,z:0}];
export class SquadPlanner {
 private missions:Record<string,SquadMission>={};private track:Contact|undefined;private nextTick=-1;private roster='';private danger='';private level=-1;private lastTick=-1;private revision=0;private contactActive=false;
 reset():void{this.missions={};this.track=undefined;this.nextTick=-1;this.roster='';this.danger='';this.level=-1;this.lastTick=-1;this.contactActive=false;}
 getRevision():number{return this.revision;}
 getMissions():Record<string,SquadMission>{return structuredClone(this.missions);}
 update(observations:TankObservation[]):Record<string,SquadMission>{
  if(!observations.length){this.reset();return {};}
  const tick=observations[0]!.own.tick,level=observations[0]!.level;
  if(level!==this.level||tick<this.lastTick)this.reset();this.level=level;this.lastTick=tick;
  const enemies=observations.filter(o=>o.own.team==='enemy').sort((a,b)=>a.own.id.localeCompare(b.own.id));
  const reports=enemies.flatMap(o=>[...o.contacts,...o.memory]).filter(c=>c.kind==='tank'&&c.team==='player'&&c.seenTick<=tick).sort((a,b)=>b.seenTick-a.seenTick||a.id.localeCompare(b.id));
  const newest=reports[0];if(newest&&(!this.track||newest.seenTick>this.track.seenTick))this.track={...newest,position:{...newest.position}};
  if(this.track&&tick-this.track.seenTick>SQUAD_HUNT_MAX_TICKS)this.track=undefined;
  const active=!!this.track&&tick-this.track.seenTick<=SQUAD_CONTACT_HYSTERESIS_TICKS;
  const roster=observations.map(o=>o.own.id).sort().join(','),danger=observations.filter(o=>o.own.shieldFraction<.35||o.recentThreat?.kind==='damage').map(o=>o.own.id).sort().join(',');
  const reached=Object.entries(this.missions).some(([id,m])=>m.kind==='search'&&tick-m.assignedTick>=15&&distance(observations.find(o=>o.own.id===id)?.own.position??m.waypoint,m.waypoint)<8);
  if(tick<this.nextTick&&roster===this.roster&&danger===this.danger&&active===this.contactActive&&!reached)return this.getMissions();
  this.roster=roster;this.danger=danger;this.contactActive=active;this.nextTick=tick+SQUAD_REVIEW_TICKS;this.revision++;
  const knownFlags=enemies.flatMap(o=>[...o.contacts,...o.memory]).filter(c=>c.kind==='flag');
  const track=this.track?{position:{...this.track.position},heading:this.track.heading,seenTick:this.track.seenTick,ageSeconds:(tick-this.track.seenTick)/30,uncertainty:Math.min(45,4+(tick-this.track.seenTick)/10)}:undefined;
  const result:Record<string,SquadMission>={};
  for(const [slot,o]of enemies.entries()){
   const own=o.own;let kind:SquadMission['kind']='search',role:SquadMission['role']='scout',waypoint={...sectors[(slot*Math.floor(sectors.length/Math.max(1,enemies.length))+this.revision-1)%sectors.length]!},reason='Search distinct squad sector and report visual contact';
   const afraid=own.shieldFraction<.35||!!o.recentThreat;
   if(afraid){kind='recover';role='support';reason='One-life survival: regain distance or cover; support only through a safe firing lane';const away=track?datan2(own.position.x-track.position.x,own.position.z-track.position.z):own.heading+Math.PI;waypoint={x:own.position.x+dsin(away)*18,z:own.position.z+dcos(away)*18};}
   else if(track){
    const age=track.ageSeconds;
    if(!active){kind='hunt';role=slot===1?'flanker':'scout';reason='Hunt dated sighting; heading is last observed, widen search with uncertainty';const heading=track.heading??0;const advance=Math.min(18,age*8);const spread=(slot-(enemies.length-1)/2)*Math.min(18,track.uncertainty);waypoint={x:track.position.x+dsin(heading)*advance+dcos(heading)*spread,z:track.position.z+dcos(heading)*advance-dsin(heading)*spread};}
    else if(slot===2&&knownFlags.length){kind='intercept';role='interceptor';reason='Intercept observed player approach to a squad-known objective';const flag=knownFlags.slice().sort((a,b)=>distance(track.position,a.position)-distance(track.position,b.position))[0]!;const bearing=datan2(own.position.x-flag.position.x,own.position.z-flag.position.z);waypoint={x:flag.position.x+dsin(bearing)*12,z:flag.position.z+dcos(bearing)*12};}
    else{kind='attack';role=slot===1?'flanker':'assault';reason=slot===1?'Establish a separate flank firing lane on reported player':'Attack observed player with stand-off and safe firing';const gap=Math.max(1,distance(own.position,track.position)),dx=(own.position.x-track.position.x)/gap,dz=(own.position.z-track.position.z)/gap;waypoint={x:track.position.x+dx*14-dz*(slot===1?14:0),z:track.position.z+dz*14+dx*(slot===1?14:0)};}
   }
   const bound=o.bounds-8;waypoint={x:Math.max(-bound,Math.min(bound,waypoint.x)),z:Math.max(-bound,Math.min(bound,waypoint.z))};
   result[own.id]={id:'mission-'+this.revision+'-'+own.id,kind,role,assignedTick:tick,reviewTick:this.nextTick,waypoint,targetId:track?.position?this.track?.id:undefined,track:track?structuredClone(track):undefined,reason};
  }
  for(const o of observations.filter(o=>o.own.team==='player')){
   const hurt=o.own.shieldFraction<.5||!!o.recentThreat;const options=[...o.contacts,...o.memory].filter(c=>hurt?c.kind==='pickup'&&c.pickupKind==='shield':c.kind==='flag').sort((a,b)=>distance(o.own.position,a.position)-distance(o.own.position,b.position));
   const goal=options[0];result[o.own.id]={id:'mission-'+this.revision+'-'+o.own.id,kind:hurt?'recover':'search',role:'scout',assignedTick:tick,reviewTick:this.nextTick,waypoint:goal?{...goal.position}:{...sectors[this.revision%sectors.length]!},reason:hurt?'Preserve the last life; seek known shield supply or safe cover':'Collect personally known flags while avoiding unsafe fights'};
  }
  this.missions=result;return this.getMissions();
 }
}
