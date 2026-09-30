import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { GameState } from '../src/sim/types.ts';
import type { SimEvent } from '../src/sim/events.ts';
import { hashState } from '../src/sim/hash.ts';
import { createInitialState, step } from '../src/sim/simulation.ts';
import { createRng } from '../src/sim/rng.ts';
import { safeExternalEnemyShot, updateProjectiles, fireProjectile } from '../src/sim/weapons.ts';
import { commandForPlan } from '../src/jev/controller.ts';
import { DEFAULT_LOADOUT } from '../src/config/constants.ts';
const f=JSON.parse(readFileSync(new URL('./fixtures/jev-friendly-fire-271.json',import.meta.url),'utf8'));
const recorded=f.firingState as GameState;recorded.rng=createRng(f.firingState.rng.state);
const owner=recorded.enemies[0]!;
assert.equal(commandForPlan(recorded,owner.id,{id:'engage:player',strategy:'pursue',description:'Recorded fire fixture',waypoint:{...owner.position},targetId:'player',fire:true,expiresTick:300}).fire,false,'controller firing tail suppresses same real ally risk');
assert.equal(safeExternalEnemyShot(recorded,owner),false,'recorded tick254 shot must be suppressed before moving ally hit tick271');
const base=()=>{const s=createInitialState(5,[{loadout:DEFAULT_LOADOUT}],'solo');s.obstacles=[];s.enemies.splice(2);s.players[0]!.position={x:0,z:20};s.enemies[0]!.position={x:0,z:0};s.enemies[0]!.heading=0;return s;};
const behind=base();behind.enemies[1]!.position={x:0,z:45};behind.enemies[1]!.speed=0;assert.equal(safeExternalEnemyShot(behind,behind.enemies[0]!),false,'ally behind target remains unsafe if target dodges');
const crossing=base();crossing.enemies[1]!.position={x:10,z:60};crossing.enemies[1]!.heading=-Math.PI/2;crossing.enemies[1]!.speed=20;assert.equal(safeExternalEnemyShot(crossing,crossing.enemies[0]!),false,'moving ally can enter whole-flight ray');
const clear=base();clear.enemies[1]!.position={x:70,z:60};clear.enemies[1]!.speed=0;assert.equal(safeExternalEnemyShot(clear,clear.enemies[0]!),true,'clear distant ally does not prevent shooting');
// Replay actual recorded positions independently of physics or command policy.
const replay=(guarded:boolean)=>{const s=structuredClone(f.shotState) as GameState;s.rng=createRng(f.shotState.rng.state);if(guarded)s.projectiles=[];const events:SimEvent[]=[];for(let tick=255;tick<=272;tick++){for(const pose of f.poses.filter((p:{tick:number})=>p.tick===tick)){const tank=[...s.enemies,...s.players].find(t=>t.id===pose.id)!;tank.position={...pose.position};tank.heading=pose.heading;tank.speed=pose.speed;}updateProjectiles(s,events);}return events;};
assert.ok(replay(false).some(e=>e.type==='FriendlyFireHit'),'recording fixture reproduces actual unsafe projectile damage');assert.ok(!replay(true).some(e=>e.type==='FriendlyFireHit'),'suppressed recorded launch prevents ally damage');
// Target dodges after the launch; guard prevents shell continuing into ally behind it.
const flight=(guarded:boolean)=>{const s=base();s.enemies[1]!.position={x:0,z:45};if(!guarded||safeExternalEnemyShot(s,s.enemies[0]!))fireProjectile(s,s.enemies[0]!,0,[]);s.players[0]!.position.x=40;const e:SimEvent[]=[];for(let i=0;i<30;i++)updateProjectiles(s,e);return e;};assert.ok(flight(false).some(e=>e.type==='FriendlyFireHit'));assert.ok(!flight(true).some(e=>e.type==='FriendlyFireHit'));
console.log('Recorded tick271 friendly damage, behind-target dodge and moving-ally full-flight guards pass.');

const movingFlight=(guarded:boolean)=>{const s=base();const ally=s.enemies[1]!;ally.position={x:10,z:60};ally.heading=-Math.PI/2;ally.speed=20;if(!guarded||safeExternalEnemyShot(s,s.enemies[0]!))fireProjectile(s,s.enemies[0]!,0,[]);s.players[0]!.position.x=40;const e:SimEvent[]=[];for(let i=0;i<30;i++){ally.position.x-=20/30;updateProjectiles(s,e);}return e;};assert.ok(movingFlight(false).some(e=>e.type==='FriendlyFireHit'));assert.ok(!movingFlight(true).some(e=>e.type==='FriendlyFireHit'),'moving crossing ally takes no damage with guarded launch');
const baseline=JSON.parse(readFileSync(new URL('./fixtures/jev-normal-fire-hashes.json',import.meta.url),'utf8'));
for(let level=1;level<=baseline.levels;level++){const s=createInitialState(level,[{loadout:DEFAULT_LOADOUT}],'solo');s.god=true;for(let t=0;t<baseline.ticksPerLevel;t++)step(s,{player:{turn:t%40<20?1:-1,thrust:1,fire:t%3===0,grenade:false}});assert.equal(hashState(s),baseline.hashes[level-1],`ordinary level${level} sim hash unchanged`);}
console.log('Moving ally extended flight and twenty normal-level baseline hashes pass.');
