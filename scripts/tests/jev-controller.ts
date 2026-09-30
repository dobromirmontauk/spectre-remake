import assert from 'node:assert/strict';
import {createInitialState} from '../../src/sim/simulation.ts';
import {observeTank} from '../../src/jev/observation.ts';
import {buildCandidates,commandForPlan} from '../../src/jev/controller.ts';
import {applyMovement} from '../../src/sim/movement.ts';
const s=createInitialState(1,[{loadout:{speed:10,shields:100,ammo:100}}]);
s.obstacles=[];s.flags=[];s.pickups=[];s.players[0]!.position={x:0,z:0};s.players[0]!.heading=0;
const player=s.players[0]!;const e=s.enemies[0]!;s.enemies=[e];e.position={x:0,z:20};e.alive=true;
const memory={seen:{}};assert.equal(observeTank(s,'player',memory).contacts.length,1,'visible target');
e.position={x:0,z:-20};assert.equal(observeTank(s,'player',{seen:{}}).contacts.length,0,'FOV hides rear');
e.position={x:0,z:90};assert.equal(observeTank(s,'player',{seen:{}}).contacts.length,0,'range hides remote');
e.position={x:0,z:20};s.obstacles=[{id:'wall',kind:'wall',min:{x:-5,z:8},max:{x:5,z:10}}];assert.equal(observeTank(s,'player',{seen:{}}).contacts.length,0,'wall occludes target');
const before=JSON.stringify(s);const obs=observeTank(s,'player',memory);assert.equal(JSON.stringify(s),before,'observation never mutates sim');assert(!JSON.stringify(obs).includes('lastHitBy'),'no enemy HP/hidden state');
const plan={id:'test',description:'test',waypoint:{x:0,z:30},targetId:e.id,fire:true,expiresTick:100};
player.speed=15;const cmd=commandForPlan(s,'player',plan);assert(cmd.thrust!==1,'brake before wall');
for(let i=0;i<20;i++){const c=commandForPlan(s,'player',plan);applyMovement(player,c,player.movement);assert(player.position.z<6.4,'executor avoids barrier continuously');}
s.obstacles=[];player.position={x:0,z:0};player.speed=0;e.position={x:0,z:4};assert(commandForPlan(s,'player',plan).thrust!==1,'does not ram target');
// Enemy friendly fire ray: player is forward of enemy, ally lies between.
e.position={x:0,z:-20};e.heading=0;player.position={x:0,z:20};const ally={...e,id:'ally',position:{x:0,z:0},prevPosition:{x:0,z:0}};s.enemies.push(ally);
assert.equal(commandForPlan(s,e.id,{...plan,targetId:'player',waypoint:{x:0,z:-10}}).fire,false,'ally blocks cannon');
s.enemies=[e];assert.equal(commandForPlan(s,e.id,{...plan,targetId:'player',waypoint:{x:0,z:-10}}).fire,true,'clear line fires');
player.position={x:0,z:0};player.heading=0;s.enemies=[];
assert(buildCandidates(observeTank(s,'player',{seen:{}})).some(p=>p.id.startsWith('explore:')),'no targets still explores');
s.obstacles=[{id:'mill',kind:'windmill',position:{x:0,z:5},pylonRadius:2,bladeAngle:0,prevBladeAngle:0,bladeLength:8}];assert(commandForPlan(s,'player',plan).thrust!==1,'windmill blocks route');
console.log('Jev controller: perception, wall, windmill, ram, ally-fire, exploration and sim immutability passed');
