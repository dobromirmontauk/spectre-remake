import assert from 'node:assert/strict';
import { createInitialState, step } from '../src/sim/simulation.ts';
import { DEFAULT_LOADOUT, ENEMY_FIRE_COOLDOWN_JITTER_TICKS } from '../src/config/constants.ts';
import { levelConfig } from '../src/config/levels.ts';
for (const level of [1,6,20]) {
 const state=createInitialState(level,[{loadout:DEFAULT_LOADOUT}],'solo');state.obstacles=[];state.flags=[];state.god=true;
 const enemy=state.enemies[0]!;state.enemies=[enemy];enemy.position={x:0,z:0};enemy.heading=0;state.players[0]!.position={x:0,z:30};
 const ammo=enemy.ammo,shots:number[]=[];
 for(let i=0;i<240;i++){step(state,{},[],{[enemy.id]:{command:{turn:0,thrust:0,fire:true,grenade:false},fireHeading:1}});if(state.events.some(e=>e.type==='ShotFired'&&e.ownerId===enemy.id))shots.push(i);}
 assert.ok(shots.length>1);
 for(let i=1;i<shots.length;i++){const gap=shots[i]!-shots[i-1]!;assert.ok(gap>=levelConfig(level).enemyFireCooldownTicks && gap<levelConfig(level).enemyFireCooldownTicks+ENEMY_FIRE_COOLDOWN_JITTER_TICKS,`level ${level}: illegal cadence ${gap}`);}
 assert.equal(enemy.ammo,ammo,'enemy ammo semantics unchanged');
}
console.log('External continuous fire respects level cooldown and unchanged enemy ammo.');
const fresh=()=>{const s=createInitialState(1,[{loadout:DEFAULT_LOADOUT}],'solo');s.obstacles=[];s.flags=[];s.god=true;s.enemies=[s.enemies[0]!];s.enemies[0]!.position={x:0,z:0};s.enemies[0]!.heading=0;s.players[0]!.position={x:0,z:30};return s;};
const turned=fresh(), tank=turned.enemies[0]!;
step(turned,{},[],{[tank.id]:{command:{turn:1,thrust:0,fire:true,grenade:false},fireHeading:1}});
const shot=turned.events.find(e=>e.type==='ShotFired');assert.ok(shot?.type==='ShotFired');assert.equal(shot.heading,tank.heading,'uses actual post-turn heading');
const blocked=fresh();blocked.obstacles=[{id:'block',kind:'wall',min:{x:-3,z:10},max:{x:3,z:12}}];
step(blocked,{},[],{[blocked.enemies[0]!.id]:{command:{turn:0,thrust:0,fire:true,grenade:false},fireHeading:0}});
assert.ok(!blocked.events.some(e=>e.type==='ShotFired'),'obstacle blocks external shot');
const normalA=fresh(),normalB=fresh();
for(let i=0;i<60;i++){step(normalA,{});step(normalB,{},[],{});assert.equal(JSON.stringify(normalA),JSON.stringify(normalB),'empty external map preserves normal sim');}
console.log('Post-turn heading, obstacle recheck, and untouched normal-path determinism pass.');
