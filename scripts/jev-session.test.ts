import assert from 'node:assert/strict';
import { JevSession } from '../src/game/jev-session.ts';
import { createInitialState } from '../src/sim/simulation.ts';
import { DEFAULT_LOADOUT } from '../src/config/constants.ts';

const makeState = () => createInitialState(1, [{loadout:DEFAULT_LOADOUT}], 'solo');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let requests: unknown[] = [];
const mock = (async (_url: unknown, init: RequestInit) => {
  const body = JSON.parse(String(init.body)); requests.push(body);
  return new Response(JSON.stringify({sequence:body.sequence,tick:body.tick,decisions:body.tanks.map((tank: {tankId:string;candidates:{id:string}[]}) => ({tankId:tank.tankId,choice:tank.candidates[0]!.id})),usage:{inputTokens:123},spentUsd:0.001}));
}) as typeof fetch;
const state = makeState(), jev = new JevSession(mock);
jev.update(state,0,true,true,true); await flush(); assert.equal(requests.length,0,'disabled sends no requests');
jev.configure({enabled:true,playerAutopilot:true,hz:5});
jev.update(state,0,true,true,true); await flush();
assert.equal(requests.length,1); assert.ok(jev.getStats().modelDecisions>0);
jev.update(state,100,true,true,true); await flush(); assert.equal(requests.length,1,'5 Hz cadence');
jev.update(state,200,true,true,true); await flush(); assert.equal(requests.length,2);
jev.update(state,400,false,true,true); await flush(); assert.equal(requests.length,2,'paused no requests');
jev.update(state,600,true,true,false); await flush(); assert.equal(requests.length,2,'background no requests');
jev.update(state,800,true,false,true); await flush(); assert.equal(requests.length,2,'net no requests');
state.mode='coop'; jev.update(state,1000,true,true,true); await flush(); assert.equal(requests.length,2,'coop no requests');
state.mode='solo'; state.enemies.push(...makeState().enemies,...makeState().enemies); jev.enforceRoster(state); assert.ok(state.enemies.length<=3);
const offline = new JevSession((async()=> {throw new Error('offline');}) as typeof fetch);
offline.configure({enabled:true}); offline.update(state,0,true,true,true); await flush(); assert.equal(offline.getStats().failures,1); assert.match(offline.getStats().status,/Offline fallback/); assert.ok(offline.commands(state,true));
let finish: (r:Response)=>void = ()=>{};
const delayed = new JevSession((async()=>await new Promise<Response>(r=>{finish=r;})) as typeof fetch);
delayed.configure({enabled:true}); delayed.update(state,0,true,true,true);
state.tick+=100; finish(new Response(JSON.stringify({sequence:1,tick:0,decisions:[]}))); await flush(); assert.equal(delayed.getStats().staleResponses,1);
console.log('Jev scheduler tests passed: disabled, cadence, pause, hidden, network, coop, cap, offline, stale.');

// Physical contacts are emitted on resolved penetration, never on a mere near miss.
const { step } = await import('../src/sim/simulation.ts');
const { updateProjectiles } = await import('../src/sim/weapons.ts');
const physics = makeState(); physics.obstacles=[];
const enemy = physics.enemies[0]!;
enemy.position={...physics.players[0]!.position};
step(physics, {});
assert.ok(physics.events.some(e=>e.type==='TankContact' && e.penetration>0));
const ally = physics.enemies[1]!;
ally.position={x:20,z:20}; enemy.position={x:20,z:10};
physics.projectiles=[{id:'test-shot',ownerId:enemy.id,position:{x:20,z:19.5},prevPosition:{x:20,z:19.5},heading:0,speed:30,ticksRemaining:10}];
const events: import('../src/sim/events.ts').SimEvent[]=[];
updateProjectiles(physics,events);
assert.ok(events.some(e=>e.type==='FriendlyFireHit' && e.damage>0));
console.log('Physical telemetry tests passed: resolved tank penetration and actual friendly projectile damage.');
