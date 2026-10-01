import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCandidates} from '../../src/jev/controller.ts';
import type {TankObservation} from '../../src/jev/types.ts';
const stall=JSON.parse(readFileSync('test/validation/jev-ai/last-game-stall/evidence.json','utf8'));
for(const item of stall.lastRequest.details.request.tanks){
 const observation=item.observation as TankObservation;
 const origin=stall.lastRequest.details.request.tanks.find((x:{tankId:string})=>x.tankId!==item.tankId).observation.contacts.find((c:{id:string})=>c.id===item.tankId).position;
 const oldId='patrol:flag-4:'+(item.tankId.endsWith('0')?'-1':'1');
 assert(!buildCandidates(observation,origin).some(p=>p.id===oldId),'recorded ally-occupied patrol is not offered repeatedly');
 assert(buildCandidates(observation,origin).some(p=>p.id!=='scan'),'safe movement alternatives remain');
}
import {SquadPlanner} from '../../src/jev/squad.ts';
import {createInitialState,step} from '../../src/sim/simulation.ts';
import {DEFAULT_LOADOUT} from '../../src/config/constants.ts';
import {observeTank} from '../../src/jev/observation.ts';
import {commandForPlan} from '../../src/jev/controller.ts';
import {JevSession} from '../../src/game/jev-session.ts';
import type {TacticalPlan} from '../../src/jev/types.ts';
const world=createInitialState(1,[{loadout:DEFAULT_LOADOUT}]);world.obstacles=[];world.enemies=world.enemies.slice(0,3);if(world.enemies.length<3)world.enemies.push({...world.enemies[0]!,id:'enemy-L1-2',position:{x:45,z:0},prevPosition:{x:45,z:0}});world.players[0]!.position={x:0,z:-85};
for(const [i,e]of world.enemies.entries()){e.position={x:(i-1)*45,z:0};e.heading=0;e.speed=0;}
const own=()=>world.enemies.map(e=>observeTank(world,e.id,{seen:{}}));
const planner=new SquadPlanner();const first=planner.update(own());assert.equal(Object.keys(first).length,3);
assert.equal(new Set(Object.values(first).map(m=>JSON.stringify(m.waypoint))).size,3,'distinct search sectors');assert(Object.values(first).every(m=>m.kind==='search'));
for(let tick=1;tick<120;tick++){world.tick=tick;assert.deepEqual(planner.update(own()),first,'missions immutable during4sec review interval');}
world.tick=120;assert.notDeepEqual(planner.update(own()),first,'planned sector review progresses after4sec');
world.tick=121;const sight=own();sight[0]!.contacts.push({id:'player',kind:'tank',team:'player',source:'own',position:{x:10,z:20},heading:1,seenTick:121});
const combat=planner.update(sight);assert(Object.values(combat).some(m=>m.kind==='attack'));assert(Object.values(combat).some(m=>m.kind==='intercept'));
world.tick=130;const unseen=planner.update(own());assert.deepEqual(unseen,combat,'short visibility flicker cannot jiggle missions');
world.tick=170;world.players[0]!.position={x:80,z:-80};const hunt=planner.update(own());assert(Object.values(hunt).every(m=>m.kind==='hunt'),'lost contact becomes dated hunt');
assert(Object.values(hunt).every(m=>m.track?.seenTick===121&&m.track.heading===1&&m.track.ageSeconds>0&&m.track.uncertainty>4),'hunt preserves last seen heading/time with growing uncertainty');
world.tick=171;const injured=own();injured[0]!.own.shieldFraction=1/3;injured[0]!.own.livesRemaining=1;
const fear=planner.update(injured);assert.equal(fear[world.enemies[0]!.id]!.kind,'recover','lastlife low shield overrides offensive mission');
const fearObservation={...injured[0]!,mission:fear[world.enemies[0]!.id]};assert(buildCandidates(fearObservation).every(p=>p.missionId===fearObservation.mission!.id&&['evade','cover','reposition','peek'].includes(p.tactic!)),'fear actions remain mission-bound safety maneuvers');
// Early-level radio is explicit mode context; default limited observer remains private.
world.tick=200;const report={id:'player',kind:'tank' as const,team:'player' as const,position:{x:10,z:20},heading:1,seenTick:200,source:'own' as const};
const receiver=world.enemies[2]!;receiver.heading=Math.PI;world.players[0]!.position={x:0,z:85};
assert(!observeTank(world,receiver.id,{seen:{}},{sharedSightings:[report]}).contacts.some(c=>c.id==='player'),'legacyearly tier cannot hear squad reports');
const radio=observeTank(world,receiver.id,{seen:{}},{radio:true,sharedSightings:[report]});assert(radio.contacts.some(c=>c.id==='player'&&c.source==='shared'&&c.heading===1),'AIearly tier radios genuinely observed position only');
world.players[0]!.position={x:90,z:90};assert.deepEqual(observeTank(world,receiver.id,{seen:{}},{radio:true,sharedSightings:[report]}).contacts.find(c=>c.id==='player'),radio.contacts.find(c=>c.id==='player'),'hidden target movement does not refresh radio');
const tactical={...radio,mission:hunt[receiver.id]!};const choices=buildCandidates(tactical,receiver.position);
assert(choices.length&&choices.length<=16&&choices.every(p=>p.missionId===tactical.mission.id&&!/^(patrol|engage|intercept):/.test(p.id)),'2Hz options are tactical actions not mission reselection');
const blockedFeedback={...tactical,own:{...tactical.own,motionFeedback:{windowTicks:60,distanceMoved:0,stalledTicks:60,blockedTicks:60,lastIntervention:'tank' as const,failedWaypoint:choices.find(p=>p.tactic==='advance')?.waypoint,progress:false}}};
assert(buildCandidates(blockedFeedback,receiver.position).some(p=>p.tactic==='reposition'),'own sustained stall receives alternate lane');
// Actual request/response/session path; injected mock never makes paid requests.
let requests:any[]=[];const mock=(async(_url:unknown,init:RequestInit)=>{const request=JSON.parse(String(init.body));requests.push(request);return new Response(JSON.stringify({sequence:request.sequence,tick:request.tick,decisions:request.tanks.map((t:any)=>({tankId:t.tankId,choice:t.candidates[0].id}))}));}) as typeof fetch;
const session=new JevSession(mock,()=>.2);session.configure({aiMode:true,playerAutopilot:true});assert.equal(session.getStats().enabled,true);assert.equal(session.getStats().hz,2);assert.equal(session.getStats().aiMode,true);
const frame=createInitialState(1,[{loadout:DEFAULT_LOADOUT}]);frame.enemies=frame.enemies.slice(0,3);frame.obstacles=[];session.enforceRoster(frame);
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));session.update(frame,0,true,true,true);await flush();await flush();
assert.equal(requests.length,1);assert(requests[0].tanks.every((t:any)=>t.observation.mission&&t.observation.own.motionFeedback&&t.observation.own.livesRemaining!==undefined),'AI payload exposes limited mission+own telemetry');
assert(Object.entries(session.getStats().latestPlans).every(([id,p])=>p.missionId&&p.missionId===session.getStats().missions[id]?.id),'accepted tactical plans preserve mission identity');
let maxWire=0;const starts=frame.enemies.map(e=>({...e.position}));
for(let tick=0;tick<180;tick++){
 if(tick%15===0){session.update(frame,500+tick*34,true,true,true);await flush();await flush();}
 const commands=session.commands(frame,true)!;step(frame,commands.player?{player:commands.player}:{},[],commands.enemies);session.recordTick(frame);
 assert(!frame.events.some(e=>e.type==='TankContact'||e.type==='ObstacleContact'||e.type==='FriendlyFireHit'),'mocked actual AI session remains physically safe');
 for(const t of requests.at(-1).tanks)maxWire=Math.max(maxWire,JSON.stringify(t.observation).length);
}
for(const [i,e]of frame.enemies.entries())assert(Math.hypot(e.position.x-starts[i]!.x,e.position.z-starts[i]!.z)>3,'search mission makes actual progress');
assert(Object.values(session.getStats().motionFeedback).some(f=>f.distanceMoved>1&&f.progress),'actual own movement telemetry measures progress');assert(maxWire<=6000,'new commander context fits backend observation cap');
session.configure({aiMode:false});assert.equal(session.getStats().enabled,false);session.configure({enabled:true});assert.equal(session.getStats().aiMode,false,'legacyJev remains separate');
console.log('Squad search/contact/hunt/fear/mission stability and actual session180ticks pass; max wire',maxWire);
// The user's final level1 deadlock, now through the actual AI session and physics.
const stalledState=createInitialState(1,[{loadout:DEFAULT_LOADOUT}]);stalledState.tick=stall.lastRequest.tick;stalledState.enemies=stalledState.enemies.slice(0,2);stalledState.players[0]!.position={x:80,z:-80};
for(const item of stall.lastRequest.details.request.tanks){const tank=stalledState.enemies.find(e=>e.id===item.tankId)!;
const origin=stall.lastRequest.details.request.tanks.find((x:{tankId:string})=>x.tankId!==item.tankId).observation.contacts.find((c:{id:string})=>c.id===item.tankId).position;
tank.position={...origin};tank.prevPosition={...origin};tank.heading=item.observation.own.heading;tank.speed=item.observation.own.speed;}
const recoverySession=new JevSession(mock,()=>.2);recoverySession.configure({aiMode:true});const recoveryStart=stalledState.enemies.map(e=>({...e.position}));
for(let tick=0;tick<180;tick++){
 if(tick%15===0){recoverySession.update(stalledState,tick*34,true,true,true);await flush();await flush();}
 const commands=recoverySession.commands(stalledState,true)!;step(stalledState,{},[],commands.enemies);recoverySession.recordTick(stalledState);
 assert(!stalledState.events.some(e=>e.type==='TankContact'||e.type==='ObstacleContact'||e.type==='FriendlyFireHit'),'recorded deadlock recovery retains all physical guards');
}
const recoveryDistance=stalledState.enemies.map((e,i)=>Math.hypot(e.position.x-recoveryStart[i]!.x,e.position.z-recoveryStart[i]!.z));
assert(recoveryDistance.every(d=>d>5),'both formerly stuck enemies make progress');
assert(Object.values(recoverySession.getStats().missions).every(m=>m.kind==='search'),'lost-contact enemies search rather than indefinitely circle flags');
console.log('Recorded last-game AI mission recovery180ticks displacement',recoveryDistance);
const attackBase=own()[0]!;attackBase.contacts=[{id:'player',kind:'tank',team:'player',source:'own',position:{x:10,z:20},seenTick:world.tick}];attackBase.geometry=[];attackBase.mission={...combat[attackBase.own.id]!,kind:'attack',role:'assault'};
const currentAdvance=buildCandidates(attackBase,world.enemies[0]!.position).find(p=>p.tactic==='advance')!;
const movingObserved=structuredClone(attackBase);movingObserved.contacts[0]!.position={x:40,z:20};
const changedAdvance=buildCandidates(movingObserved,world.enemies[0]!.position).find(p=>p.tactic==='advance')!;
assert(currentAdvance&&changedAdvance);assert.notDeepEqual(currentAdvance.waypoint,changedAdvance.waypoint,'tactics react to current personally visible target movement');assert.equal(changedAdvance.missionId,currentAdvance.missionId,'fast target adjustment cannot reassign mission');
attackBase.own.motionFeedback={windowTicks:60,distanceMoved:0,stalledTicks:60,blockedTicks:0,firedRecently:true,progress:true};
assert(buildCandidates(attackBase,world.enemies[0]!.position).some(p=>p.tactic==='fire'),'productive safe stationary fire is not mistaken for failed movement');
const collecting=observeTank(frame,'player',{seen:{}});collecting.geometry=[];collecting.contacts=[{id:'knownEnemy',kind:'tank',team:'enemy',source:'own',position:{x:collecting.own.position.x+30,z:collecting.own.position.z+5},seenTick:frame.tick}];collecting.mission={id:'collect-mission',kind:'search',role:'scout',assignedTick:frame.tick,reviewTick:frame.tick+120,waypoint:{x:collecting.own.position.x+15,z:collecting.own.position.z},reason:'Collect known flag'};
assert(buildCandidates(collecting).some(p=>p.fire&&p.targetId==='knownEnemy'),'player can fire opportunistically while collecting without changing mission');
for(const level of [1,2,3,5]){const state=createInitialState(level,[{loadout:DEFAULT_LOADOUT}]);const obs=observeTank(state,state.enemies[0]!.id,{seen:{}});obs.own.motionFeedback={windowTicks:60,distanceMoved:10,stalledTicks:0,blockedTicks:0,progress:true};obs.mission=new SquadPlanner().update([obs])[obs.own.id];assert(JSON.stringify(obs).length<=6000,'mission wire remains capped at tier'+level);}
console.log('Fast own-target firing/steering, productive-fire and tier wire bounds pass');
