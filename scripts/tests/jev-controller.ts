import assert from 'node:assert/strict';
import {createInitialState} from '../../src/sim/simulation.ts';
import {observeTank} from '../../src/jev/observation.ts';
import {buildCandidates,commandForPlan} from '../../src/jev/controller.ts';
import {movementParamsForEnemy} from '../../src/sim/ai.ts';
import {levelConfig} from '../../src/config/levels.ts';
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
// Hidden obstacle geometry must not become commander map knowledge.
s.obstacles=[{id:'rear-secret',kind:'wall',min:{x:-3,z:-32},max:{x:3,z:-28}}];
assert.equal(observeTank(s,'player',{seen:{}}).geometry.length,0,'rear geometry remains hidden');
s.obstacles=[{id:'front-screen',kind:'wall',min:{x:-20,z:9},max:{x:20,z:11}},{id:'occluded-secret',kind:'windmill',position:{x:0,z:30},pylonRadius:2,bladeAngle:0,prevBladeAngle:0,bladeLength:8}];
assert(!observeTank(s,'player',{seen:{}}).geometry.some(o=>o.id==='occluded-secret'),'occluded geometry remains hidden');
s.obstacles=[];e.position={x:0,z:30};s.enemies=[e];
const choices=buildCandidates(observeTank(s,'player',{seen:{}}));
const flanks=choices.filter(c=>c.id.startsWith('flank:'));
assert.equal(flanks.length,2);assert.notEqual(flanks[0]!.description,flanks[1]!.description,'flank descriptions distinguish direction');
assert(choices.every(c=>c.description.includes('units')||c.id==='scan'),'wire candidate descriptions give travel consequence');
s.enemies=Array.from({length:6},(_,i)=>({...e,id:'target'+i,position:{x:i*3,z:30}}));assert(buildCandidates(observeTank(s,'player',{seen:{}})).length<=16,'candidate bounded16');
s.enemies=[];s.obstacles=[{id:'distant-brake',kind:'wall',min:{x:-5,z:25},max:{x:5,z:27}}];player.speed=18;player.heading=0;
assert(commandForPlan(s,'player',plan).thrust!==1,'predict coast after decision horizon before accelerating');
s.obstacles=[{id:'too-close',kind:'wall',min:{x:-5,z:4},max:{x:5,z:6}}];
assert.equal(commandForPlan(s,'player',plan).thrust,-1,'unavoidable proximity uses maximum brake rather than coast');
player.speed=0;s.obstacles=[{id:'tactile-rear',kind:'wall',min:{x:-2,z:-3},max:{x:2,z:-2}}];
assert.equal(observeTank(s,'player',{seen:{}}).geometry.length,1,'immediate tactile geometry allowed');
s.obstacles=[];e.position={x:4,z:60};s.enemies=[e];
assert.equal(commandForPlan(s,'player',plan).fire,false,'aim cone alone cannot fire a ray that misses target');
console.log('Additional geometry, bounded descriptions, braking and actual cannon-ray regressions passed');
// Exact observed deadlock: both tanks outside physical diameter but inside safety margin.
s.obstacles=[];s.enemies=[e];player.position={x:45,z:-29};e.position={x:42,z:-31};player.heading=0;e.heading=0;player.speed=0;e.speed=0;e.alive=true;
for(let tick=0;tick<600;tick++){
 s.tick=tick;const pc=commandForPlan(s,'player',{...plan,waypoint:{x:42,z:-31},expiresTick:tick+30});
 const ec=commandForPlan(s,e.id,{...plan,targetId:'player',waypoint:{x:45,z:-29},expiresTick:tick+30});
 applyMovement(player,pc,player.movement);applyMovement(e,ec,movementParamsForEnemy(e.kind,levelConfig(s.level)));
 assert(Math.hypot(player.position.x-e.position.x,player.position.z-e.position.z)>=3.2,'escape never overlaps physical hulls');
}
const escapedGap=Math.hypot(player.position.x-e.position.x,player.position.z-e.position.z);
assert(escapedGap>=6,'margin-overlap pair separates within20seconds');
console.log('Exact clearance deadlock: final gap '+escapedGap.toFixed(2)+' after600ticks, no hull overlaps');
const benchmarkStart=performance.now();
for(let i=0;i<1200;i++)commandForPlan(s,'player',{...plan,expiresTick:s.tick+30});
console.log('Controller1200 calls: '+(performance.now()-benchmarkStart).toFixed(1)+'ms');
// Two independent commanders must predict moving bodies before their hulls meet.
for(const fixture of [{name:'head-on',a:{x:0,z:-14},b:{x:0,z:14},ah:0,bh:Math.PI},{name:'crossing',a:{x:-14,z:0},b:{x:0,z:-14},ah:Math.PI/2,bh:0}]){
 s.obstacles=[];s.enemies=[e];player.position={...fixture.a};e.position={...fixture.b};player.heading=fixture.ah;e.heading=fixture.bh;player.speed=18;e.speed=18;
 const ap={x:player.position.x+Math.sin(fixture.ah)*50,z:player.position.z+Math.cos(fixture.ah)*50};const bp={x:e.position.x+Math.sin(fixture.bh)*50,z:e.position.z+Math.cos(fixture.bh)*50};
 for(let tick=0;tick<180;tick++){s.tick=tick;const pc=commandForPlan(s,'player',{...plan,waypoint:ap,expiresTick:tick+30});const ec=commandForPlan(s,e.id,{...plan,targetId:'player',waypoint:bp,expiresTick:tick+30});applyMovement(player,pc,player.movement);applyMovement(e,ec,movementParamsForEnemy(e.kind,levelConfig(s.level)));assert(Math.hypot(player.position.x-e.position.x,player.position.z-e.position.z)>=3.2,fixture.name+' moving hulls must never physically contact');}
}
// Commander objectives match simulation role: enemies cannot collect supplies or flags.
s.obstacles=[];s.players[0]!.position={x:0,z:30};e.position={x:0,z:0};e.heading=0;e.speed=0;s.enemies=[e];
s.flags=[{id:'knownFlag',position:{x:10,z:25},collected:false}];s.pickups=[{id:'knownSupply',kind:'ammo',position:{x:-10,z:25},amount:10,collected:false}];
const enemyObs=observeTank(s,e.id,{seen:{'pastSupply':{id:'pastSupply',kind:'pickup',position:{x:0,z:-20},seenTick:s.tick},'pastFlag':{id:'pastFlag',kind:'flag',position:{x:20,z:-20},seenTick:s.tick}}});
const enemyChoices=buildCandidates(enemyObs);
assert(!enemyChoices.some(c=>c.id.includes('Supply')||c.id.startsWith('flag:')||c.id.startsWith('remember:')),'enemy never chases uncollectable objectives');
assert(!enemyChoices.some(c=>c.description.includes('for flags')),'enemy exploration searches opponents');
assert(enemyChoices.some(c=>c.id.startsWith('guard:')),'enemy may guard flag with explicit vantage purpose');
player.position={x:0,z:0};player.heading=0;e.position={x:0,z:60};
player.ammo=player.maxAmmo-1;
const playerChoices=buildCandidates(observeTank(s,'player',{seen:{}}));assert(playerChoices.some(c=>c.id==='flag:knownFlag'),'player collection remains available');assert(playerChoices.some(c=>c.id==='pickup:knownSupply'),'player supplies remain available');
for(const absent of [null,{...plan,expiresTick:-1}]){
 s.tick=10;s.enemies=[];s.obstacles=[{id:'timeoutWall',kind:'wall',min:{x:-5,z:6.5},max:{x:5,z:8.5}}];player.position={x:0,z:0};player.heading=0;player.speed=15;
 assert.equal(commandForPlan(s,'player',absent).thrust,-1,'missing/expired moving plan brakes before wall');
 for(let i=0;i<60;i++){const cmd=commandForPlan(s,'player',absent);assert.equal(cmd.fire,false,'timeoutnever fires');applyMovement(player,cmd,player.movement);assert(player.position.z<4.9,'timeout path stays outside wall hull');}
 s.obstacles=[];s.enemies=[e];player.position={x:-14,z:0};e.position={x:0,z:-14};player.heading=Math.PI/2;e.heading=0;player.speed=18;e.speed=18;
 for(let i=0;i<180;i++){const pc=commandForPlan(s,'player',absent),ec=commandForPlan(s,e.id,absent);applyMovement(player,pc,player.movement);applyMovement(e,ec,movementParamsForEnemy(e.kind,levelConfig(s.level)));assert(Math.hypot(player.position.x-e.position.x,player.position.z-e.position.z)>=3.2,'missing plans crossing remainssafe');}
}
// A2Hz waypoint switch must not invalidate the braking corridor near a pylon.
s.players[0]!.position={x:-80,z:-80};s.enemies=[e];s.obstacles=[{id:'replanMill',kind:'windmill',position:{x:16.3087968043983,z:73.36144505813718},pylonRadius:1.2,bladeAngle:0,prevBladeAngle:0,bladeLength:8}];
e.position={x:12.870410415155508,z:69.32559225610696};e.heading=19.038051480754067;e.speed=13.6;
for(let tick=0;tick<180;tick++){
 s.tick=tick;const waypoint=Math.floor(tick/15)%2?{x:15.69,z:89.49}:{x:34.878,z:59.277};
 const ec=commandForPlan(s,e.id,{...plan,targetId:undefined,fire:false,waypoint,expiresTick:tick+30});applyMovement(e,ec,movementParamsForEnemy(e.kind,levelConfig(s.level)));
 assert(Math.hypot(e.position.x-16.3087968043983,e.position.z-73.36144505813718)>=2.8,'2Hz alternating plans never hit windmill');
}
s.obstacles=[{id:'replanWall',kind:'wall',min:{x:15,z:71},max:{x:18,z:76}}];e.position={x:12.87,z:69.32};e.heading=19.038;e.speed=13.6;
for(let tick=0;tick<180;tick++){s.tick=tick;const waypoint=Math.floor(tick/15)%2?{x:15.69,z:89.49}:{x:34.878,z:59.277};const cmd=commandForPlan(s,e.id,{...plan,targetId:undefined,fire:false,waypoint,expiresTick:tick+30});applyMovement(e,cmd,movementParamsForEnemy(e.kind,levelConfig(s.level)));const closest={x:Math.max(15,Math.min(18,e.position.x)),z:Math.max(71,Math.min(76,e.position.z))};assert(Math.hypot(e.position.x-closest.x,e.position.z-closest.z)>=1.6,'2Hz alternatingplans never hit wall');}
console.log('Alternating2Hz exact windmill and wall stop-envelope regressions passed');
s.enemies=[];s.obstacles=[];player.position={x:0,z:0};player.heading=0;player.ammo=player.maxAmmo;player.shield=player.maxShield;
s.flags=[{id:'goalFlag',position:{x:0,z:15},collected:false}];s.pickups=[{id:'heal',kind:'shield',position:{x:4,z:20},amount:25,collected:false},{id:'refill',kind:'ammo',position:{x:-4,z:20},amount:20,collected:false}];
const supplyMemory={seen:{}};let supplyObs=observeTank(s,'player',supplyMemory);let supplyChoices=buildCandidates(supplyObs);
assert(!supplyChoices.some(c=>c.id==='pickup:heal'),'fullshield never offers healing');assert(!supplyChoices.some(c=>c.id==='pickup:refill'),'fullammo never offers resupply');
player.shield=player.maxShield/2;player.ammo=player.maxAmmo-10;supplyObs=observeTank(s,'player',supplyMemory);supplyChoices=buildCandidates(supplyObs);
assert(supplyChoices.find(c=>c.id==='pickup:heal')?.description.includes('shield'),'needed healing explicitly offered');assert(supplyChoices.find(c=>c.id==='pickup:refill')?.description.includes('10'),'ammo benefit bounded by own missingcapacity');
assert.equal(supplyObs.contacts.find(c=>c.id==='heal')?.pickupKind,'shield','visiblepickupkind supplied');
player.heading=Math.PI;player.shield=player.maxShield;player.ammo=player.maxAmmo;
assert(!buildCandidates(observeTank(s,'player',supplyMemory)).some(c=>c.id.includes('heal')||c.id.includes('refill')),'remembered supplies also suppressed whenfull');
s.pickups.push({id:'hiddenSupply',kind:'shield',position:{x:0,z:90},amount:100,collected:false});assert(!JSON.stringify(observeTank(s,'player',{seen:{}})).includes('hiddenSupply'),'hidden supplymetadata never leaks');
