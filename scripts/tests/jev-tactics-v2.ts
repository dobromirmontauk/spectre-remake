import assert from 'node:assert/strict';
import { createInitialState, step } from '../../src/sim/simulation.ts';
import { observeTank } from '../../src/jev/observation.ts';
import { buildCandidates, commandForPlan } from '../../src/jev/controller.ts';
import type { TankMemory, Contact } from '../../src/jev/types.ts';
const s=createInitialState(1,[{loadout:{speed:10,shields:100,ammo:100}}]);s.obstacles=[];s.flags=[{id:'flag',position:{x:17,z:24},collected:false}];s.pickups=[{id:'farItem',kind:'shield',amount:25,position:{x:85,z:85},collected:false}];s.enemies=[s.enemies[0]!];
const e=s.enemies[0]!;e.position={x:3,z:2};e.heading=0;e.speed=0;s.players[0]!.position={x:0,z:90};const memory:TankMemory={seen:{}};
let o=observeTank(s,e.id,memory);assert.deepEqual(o.own.position,{x:0,z:0},'lowtier rough own navigation');assert.deepEqual(o.contacts.find(c=>c.id==='flag')?.position,{x:20,z:20},'ownseen flags roughly located');assert(!o.contacts.some(c=>c.id==='farItem'),'lowtier hiddenmapitems absent');
let candidates=buildCandidates(o);assert(candidates.some(p=>p.strategy==='patrol'),'peacefulknownflag has circular patrol');assert(candidates.filter(p=>p.strategy==='patrol').every(p=>Math.abs(Math.hypot(p.waypoint.x-20,p.waypoint.z-20)-18)<.01),'patrol18unitcircle');
e.heading=Math.PI;s.tick=300;o=observeTank(s,e.id,memory);assert(o.memory.some(c=>c.id==='flag'),'personallyseenflagmemory persists beyond shorttargetTTL');
s.level=3;o=observeTank(s,e.id,{seen:{}});assert.deepEqual(o.own.position,e.position,'level3 exactownGPS');assert(o.contacts.some(c=>c.id==='farItem'&&c.pickupKind==='shield'&&c.amount===25),'level3alltypeditemsmap');assert(o.contacts.some(c=>c.id==='flag'&&c.source==='map'),'level3allobjectivemap');
// No player omniscience below5; shared sightings require originalreport time/heading.
s.players[0]!.position={x:80,z:80};e.heading=0;const shared:Contact={id:'player',kind:'tank',team:'player',position:{x:10,z:10},heading:.75,seenTick:300,source:'own'};
s.level=4;o=observeTank(s,e.id,{seen:{}},{sharedSightings:[shared]});assert(!o.contacts.some(c=>c.id==='player'),'level4 no squadplayerreport');
s.level=5;s.tick=300;o=observeTank(s,e.id,{seen:{}},{sharedSightings:[shared]});assert.equal(o.contacts.find(c=>c.id==='player')?.source,'shared','level5 actualcurrentreportshared');
const sharedMemory:TankMemory={seen:{}};observeTank(s,e.id,sharedMemory,{sharedSightings:[shared]});s.tick=330;s.players[0]!.heading=2.7;s.players[0]!.position={x:-90,z:-90};o=observeTank(s,e.id,sharedMemory,{sharedSightings:[shared]});const stale=o.memory.find(c=>c.id==='player')!;assert.equal(stale.heading,.75,'hiddenheading never silentlyrefreshes');assert.deepEqual(stale.position,{x:10,z:10});assert.equal(stale.seenTick,300);assert.equal(stale.seenSeconds,10);assert.equal(stale.ageSeconds,1);assert.equal(o.nowSeconds,11);
const ally={...e,id:'ally',position:{x:70,z:-70},prevPosition:{x:70,z:-70}};s.enemies.push(ally);o=observeTank(s,e.id,{seen:{}},{strategies:{ally:'regroup'}});assert(o.contacts.some(c=>c.id==='ally'&&c.strategy==='regroup'&&c.source==='shared'),'level5ownrosterstrategytelemetry');assert(!o.contacts.some(c=>c.id==='player'),'rostertelemetry not hiddenplayer');
// Recent damage makes recovery a real priority and withholds attack options.
s.players[0]!.position={x:3,z:25};e.heading=0;const dangerMemory:TankMemory={seen:{}};observeTank(s,e.id,dangerMemory);e.shield-=10;s.tick++;o=observeTank(s,e.id,dangerMemory);assert.equal(o.recentThreat?.kind,'damage');assert.equal(o.recentThreat?.tick,s.tick);candidates=buildCandidates(o);assert.equal(candidates[0]!.strategy,'retreat');assert(!candidates.some(p=>p.strategy==='pursue'||(p.strategy==='protect'&&p.targetId)),'afraidcommander not given aggressive pursuit');assert(candidates.some(p=>p.strategy==='regroup'),'squadregroup available');
s.obstacles=[{id:'hiddenwall',kind:'wall',min:{x:-5,z:45},max:{x:5,z:47}}];s.projectiles=[{id:'hiddenShot',ownerId:'player',position:{x:0,z:55},prevPosition:{x:0,z:55},heading:Math.PI,speed:50,ticksRemaining:100}];const freshThreat=observeTank(s,e.id,{seen:{}});assert(!freshThreat.recentThreat,'occludedprojectile not threatmetadata');
console.log('Tier1/2/3/5 boundaries, dated sightings, circular patrol and survival strategies passed');
// Fear remains active for3seconds even if a pickup instantly restores shields.
e.shield=e.maxShield;s.tick+=60;o=observeTank(s,e.id,dangerMemory);assert(o.recentThreat&&o.recentThreat.ageSeconds===2);assert(!buildCandidates(o).some(p=>p.strategy==='pursue'),'recent damage hysteresis survives healing');
s.tick+=40;o=observeTank(s,e.id,dangerMemory);assert(!o.recentThreat,'fearexpires after3seconds without refreshedhidden threat');
// Stable patrol choices produce actual circular displacement through the full simulation.
const ps=createInitialState(3,[{loadout:{speed:10,shields:100,ammo:100}}]);ps.obstacles=[];ps.pickups=[];ps.flags=[{id:'center',position:{x:0,z:0},collected:false}];ps.enemies=[ps.enemies[0]!];ps.players[0]!.position={x:85,z:85};const pe=ps.enemies[0]!;pe.position={x:18,z:0};pe.heading=Math.PI/2;pe.speed=0;const pm:TankMemory={seen:{}};let patrolPlan:ReturnType<typeof buildCandidates>[number]|undefined;let sweptAngle=0,lastAngle=Math.atan2(pe.position.x,pe.position.z);
for(let tick=0;tick<900;tick++){
 if(tick%15===0)patrolPlan=buildCandidates(observeTank(ps,pe.id,pm)).find(p=>p.id==='patrol:center:1');
 assert(patrolPlan,'stableclockwise circular route stays available');
 const cmd=commandForPlan(ps,pe.id,{...patrolPlan,expiresTick:ps.tick+30});step(ps,{},[],{[pe.id]:{command:cmd,fireHeading:pe.heading}});
 const angle=Math.atan2(pe.position.x,pe.position.z);let delta=angle-lastAngle;while(delta>Math.PI)delta-=2*Math.PI;while(delta< -Math.PI)delta+=2*Math.PI;sweptAngle+=delta;lastAngle=angle;
 assert(!ps.events.some(e=>e.type==='ObstacleContact'||e.type==='TankContact'),'actualpatrol stayscollisionfree');
}
assert(sweptAngle>Math.PI*1.5,'patrol traverses substantial circle rather than sittingatguard');assert(Math.hypot(pe.position.x,pe.position.z)<30,'patrol staysaroundanchor');
console.log('Fullsim900tick circular patrol arc '+sweptAngle.toFixed(2)+' radians and fearhysteresis passed');
let maxObservationChars=0;
for(const level of [1,2,3,5,20]){
 const sizeState=createInitialState(level,[{loadout:{speed:10,shields:100,ammo:100}}]);sizeState.enemies=sizeState.enemies.slice(0,3);sizeState.tick=113;
 for(const observer of [sizeState.players[0]!,...sizeState.enemies])for(const point of [{x:0,z:0},{x:35,z:35},{x:-35,z:-35}])for(const heading of [0,Math.PI/2,Math.PI]){
  observer.position=point;observer.heading=heading;
  const m:TankMemory={seen:{},visited:Array.from({length:64},(_,i)=>({x:i*2,z:i*2}))};const bytes=JSON.stringify(observeTank(sizeState,observer.id,m)).length;maxObservationChars=Math.max(maxObservationChars,bytes);assert(bytes<=6000,'boundedwireobservation fits backend6000charcap');
 }
}
console.log('Tiered observation footprint max '+maxObservationChars+' JSONchars across sampledmapposes');
// A quantized rememberedflag cannot disappear because its coarse center is visible while its real point is not.
s.level=1;s.tick=0;s.enemies=[e];e.position={x:0,z:0};e.heading=0;s.flags=[{id:'edgeFov',position:{x:30,z:-15},collected:false}];s.pickups=[];s.players[0]!.position={x:80,z:80};const flagMemory:TankMemory={seen:{}};assert(observeTank(s,e.id,flagMemory).contacts.some(c=>c.id==='edgeFov'));e.heading=-.1;s.tick++;assert(observeTank(s,e.id,flagMemory).memory.some(c=>c.id==='edgeFov'),'quantizedFOV boundary preserves real personallyseenflag');

assert(buildCandidates(o).every(p=>/^[A-Za-z0-9:_-]+$/.test(p.id)),'candidateIDs satisfy wiregrammar');
// Real level5 start: healthy allies without any threat must never default to idle regroup/guard.
const l5=createInitialState(5,[{loadout:{speed:10,shields:100,ammo:100}}]);l5.enemies=l5.enemies.slice(0,3);
for(const enemy of l5.enemies){const choices=buildCandidates(observeTank(l5,enemy.id,{seen:{}}));assert(choices.length>0);assert(choices.every(p=>p.strategy==='patrol'||p.strategy==='explore'),'peacefullevel5 edge roster has only progressing patrol/search');assert(choices.some(p=>p.strategy==='patrol'),'initialedge spawn can approach feasibleknownflag then orbit');}
for(const level of [1,2,3,5]){l5.level=level;l5.flags[0]!.collected=true;const scoreObs=observeTank(l5,l5.enemies[0]!.id,{seen:{}});assert.equal(scoreObs.totalFlags,l5.flags.length,'publictotalflagcount everytier');assert.equal(scoreObs.remainingFlags,l5.flags.length-1,'publicremainingcount updatesaftercollection');}
const urgent=createInitialState(3,[{loadout:{speed:10,shields:100,ammo:100}}]);urgent.obstacles=[];urgent.enemies=[urgent.enemies[0]!];const ue=urgent.enemies[0]!;ue.position={x:0,z:0};ue.heading=0;urgent.players[0]!.position={x:0,z:25};urgent.flags=[{id:'lastFlag',position:{x:10,z:35},collected:false}];urgent.pickups=[];
let urgentChoices=buildCandidates(observeTank(urgent,ue.id,{seen:{}}));assert(urgentChoices.some(p=>p.id.startsWith('intercept:')&&p.fire),'lastflag visiblethreat getsactiveinterception');assert(urgentChoices.filter(p=>p.id.startsWith('intercept:')).every(p=>Math.hypot(p.waypoint.x-0,p.waypoint.z-25)>=12),'intercept preserves targetstandoff');ue.shield=ue.maxShield*.2;assert(!buildCandidates(observeTank(urgent,ue.id,{seen:{}})).some(p=>p.id.startsWith('intercept:')),'fear preserves recovery over suicidalurgency');
// Actual level5 edge poses progress into feasible patrol on a clear arena.
for(let slot=0;slot<3;slot++){
 const clear=createInitialState(5,[{loadout:{speed:10,shields:100,ammo:100}}]);clear.obstacles=[];clear.enemies=[clear.enemies[slot]!];clear.players[0]!.position={x:-85,z:-85};const ce=clear.enemies[0]!,cm:TankMemory={seen:{}};let chosen:ReturnType<typeof buildCandidates>[number]|undefined;let travel=0;
 for(let tick=0;tick<120;tick++){if(tick%15===0)chosen=buildCandidates(observeTank(clear,ce.id,cm)).find(p=>p.strategy==='patrol');assert(chosen,'level5edgepatrol continues');const before={...ce.position};const cmd=commandForPlan(clear,ce.id,{...chosen,expiresTick:clear.tick+30});step(clear,{},[],{[ce.id]:{command:cmd,fireHeading:ce.heading}});travel+=Math.hypot(ce.position.x-before.x,ce.position.z-before.z);assert(!clear.events.some(e=>e.type==='ObstacleContact'||e.type==='TankContact'),'clearlevel5 edgeapproach no collisions');}
 assert(travel>10,'actuallevel5edgepose makes measurablepatrolprogress');console.log('Level5 edge slot'+slot+' peaceful patrol travel '+travel.toFixed(1)+'units/4seconds');
}
