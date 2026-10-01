import assert from 'node:assert/strict';
import { createInitialState, resetGame, resetGameWithLoadout, resetGameWithRoster, rebuildLevel, step, spawnEnemyAt } from '../src/sim/simulation.ts';
import { DEFAULT_LOADOUT, PLAYER_LIVES_START, ENEMY_RESPAWN_TICKS } from '../src/config/constants.ts';
import { fireProjectile, updateProjectiles } from '../src/sim/weapons.ts';
import { hashState } from '../src/sim/hash.ts';
const ai=()=>createInitialState(5,[{loadout:DEFAULT_LOADOUT}],'solo',{aiMode:true});
const finite=ai();assert.equal(finite.aiMode,true);assert.equal(finite.players[0]!.lives,1);assert.equal(finite.enemies.length,3);
finite.enemies[0]!.shield=0;step(finite,{});assert.equal(finite.enemies[0]!.alive,false);assert.equal(finite.enemies[0]!.respawnTicksRemaining,0);
for(let i=0;i<ENEMY_RESPAWN_TICKS+10;i++)step(finite,{});assert.equal(finite.enemies[0]!.alive,false,'killed finite enemy never respawns');
for(const enemy of finite.enemies)enemy.shield=0;step(finite,{});assert.ok(finite.events.some(e=>e.type==='LevelComplete'),'destroying squad clears AI level');assert.equal(finite.events.filter(e=>e.type==='LevelComplete').length,1);
rebuildLevel(finite,6);assert.equal(finite.aiMode,true);assert.equal(finite.enemies.length,3);assert.equal(finite.players[0]!.lives,1);
const dead=ai();dead.players[0]!.shield=0;step(dead,{});assert.ok(dead.gameOver);assert.equal(dead.players[0]!.alive,false);assert.equal(dead.players[0]!.lives,0);assert.ok(!dead.events.some(e=>e.type==='PlayerRespawned'));
rebuildLevel(dead,6);assert.equal(dead.players[0]!.alive,false,'level rebuild cannot revive dead one-life player');resetGame(dead);assert.equal(dead.players[0]!.lives,1);assert.equal(dead.players[0]!.alive,true);
const flags=ai();flags.flags.forEach(f=>f.collected=true);flags.flagsCollected=flags.flags.length;step(flags,{});assert.equal(flags.events.filter(e=>e.type==='LevelComplete').length,1,'flags still clear AI level');
const simultaneous=ai();simultaneous.enemies.forEach(e=>e.shield=0);simultaneous.players[0]!.shield=0;step(simultaneous,{});assert.ok(simultaneous.gameOver);assert.ok(!simultaneous.events.some(e=>e.type==='LevelComplete'),'death wins over simultaneous squad clear');
const ordinary=createInitialState(5,[{loadout:DEFAULT_LOADOUT}]);assert.equal(ordinary.aiMode,false);assert.equal(ordinary.players[0]!.lives,PLAYER_LIVES_START);ordinary.enemies[0]!.shield=0;step(ordinary,{});for(let i=0;i<ENEMY_RESPAWN_TICKS;i++)step(ordinary,{});assert.equal(ordinary.enemies[0]!.alive,true,'ordinary enemies still respawn');
assert.throws(()=>createInitialState(1,[{loadout:DEFAULT_LOADOUT},{loadout:DEFAULT_LOADOUT}],'coop',{aiMode:true}),/solo/);
const hashA=ai(),hashB=ai();hashB.aiMode=false;assert.notEqual(hashState(hashA),hashState(hashB),'match finite-life option participates in hash');
for(let i=0;i<10;i++)spawnEnemyAt(hashA,10+i,10,'drone');assert.equal(hashA.enemies.length,3,'AI debug spawning respects finite roster cap');
resetGameWithRoster(hashA,[{loadout:DEFAULT_LOADOUT}],1,'solo');assert.equal(hashA.aiMode,false,'network/default reset clears old AI flag');assert.equal(hashA.players[0]!.lives,PLAYER_LIVES_START);
resetGameWithLoadout(hashA,DEFAULT_LOADOUT,1,{aiMode:true});assert.equal(hashA.aiMode,true);assert.equal(hashA.players[0]!.lives,1);
console.log('AI finite roster/lives/clear, reset isolation, cap and hash regressions pass.');

const shotState=createInitialState(1,[{loadout:DEFAULT_LOADOUT}]);shotState.obstacles=[];shotState.enemies.splice(1);const shooter=shotState.players[0]!,target=shotState.enemies[0]!;shooter.position={x:0,z:0};target.position={x:0,z:5};const events: import('../src/sim/events.ts').SimEvent[]=[];fireProjectile(shotState,shooter,0,events);updateProjectiles(shotState,events);const fired=events.find(e=>e.type==='ShotFired')!,hit=events.find(e=>e.type==='ShotHit')!;assert.ok(fired.type==='ShotFired'&&hit.type==='ShotHit');assert.equal(hit.projectileId,fired.projectileId);assert.equal(hit.ownerId,shooter.id);assert.equal(hit.targetId,target.id);
console.log('Actual projectile launch/hit identity links pass.');

const both=ai(),bonus=both.bonusRemaining;both.flags.forEach(f=>f.collected=true);both.flagsCollected=both.flags.length;both.enemies.forEach(e=>{e.alive=false;e.respawnTicksRemaining=0;});step(both,{});assert.equal(both.events.filter(e=>e.type==='LevelComplete').length,1);assert.equal(both.score,bonus,'combined squad/flag clear awards bonus once');
