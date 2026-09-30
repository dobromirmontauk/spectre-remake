import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialState, step } from '../../src/sim/simulation.ts';
import { createRng } from '../../src/sim/rng.ts';
import { observeTank } from '../../src/jev/observation.ts';
import { buildCandidates,commandForPlan } from '../../src/jev/controller.ts';
import { JevSession } from '../../src/game/jev-session.ts';
import type { GameState } from '../../src/sim/types.ts';
import type { TankMemory,TacticalPlan } from '../../src/jev/types.ts';
const read=(file:string)=>{const s=JSON.parse(readFileSync(file,'utf8'))as GameState;s.rng=createRng(s.rng.state);return s;};
const low=read('scripts/tests/jev-low-tier-initial.json');
const normal=read('scripts/tests/jev-low-tier-initial.json'),session=new JevSession();const before=JSON.stringify(normal);session.enforceRoster(normal);assert.equal(JSON.stringify(normal),before,'disabledJev never changes normalspawn/state');
session.configure({enabled:true});session.enforceRoster(low);
for(let i=0;i<low.enemies.length;i++)for(let j=i+1;j<low.enemies.length;j++)assert(Math.hypot(low.enemies[i]!.position.x-low.enemies[j]!.position.x,low.enemies[i]!.position.z-low.enemies[j]!.position.z)>=6.5,'Jev fresh hulls startclear');
const after=JSON.stringify(low);session.enforceRoster(low);assert.equal(JSON.stringify(low),after,'placement runs once perlife notcontinuousworldteleport');
const memories:Record<string,TankMemory>={},plans:Record<string,TacticalPlan>={},flips:Record<string,number>={},last:Record<string,number>={},travel:Record<string,number>={},stationary:Record<string,number>={},maxStationary:Record<string,number>={},oscillationWindows:Record<string,number>={},history:Record<string,{position:{x:number;z:number};heading:number;turn:number}[]>={};
for(let tick=0;tick<360;tick++){
 if(tick%15===0)for(const e of low.enemies){const choices=buildCandidates(observeTank(low,e.id,memories[e.id]??={seen:{}}),e.position);plans[e.id]=choices[0]!;assert(plans[e.id].id!=='scan','exactL2 usefulmovement tick'+tick+' '+e.id+' pos'+JSON.stringify(e.position)+' geometry'+JSON.stringify(observeTank(low,e.id,memories[e.id]!).geometry));}
 const positions=low.enemies.map(e=>({...e.position})),external:Parameters<typeof step>[3]={};
 for(const e of low.enemies){const command=commandForPlan(low,e.id,{...plans[e.id]!,fire:false,targetId:undefined,expiresTick:low.tick+30});if(last[e.id]&&command.turn&&last[e.id]!==command.turn){flips[e.id]=(flips[e.id]??0)+1;}last[e.id]=command.turn;const window=history[e.id]??=[];window.push({position:{...e.position},heading:e.heading,turn:command.turn});if(window.length>60)window.shift();if(window.length===60){let changes=0,previous=0;for(const sample of window)if(sample.turn){if(previous&&previous!==sample.turn)changes++;previous=sample.turn;}const first=window[0]!,final=window[59]!;if(changes>=4&&Math.abs(final.heading-first.heading)<.15&&Math.hypot(final.position.x-first.position.x,final.position.z-first.position.z)<1)oscillationWindows[e.id]=(oscillationWindows[e.id]??0)+1;}external[e.id]={command,fireHeading:e.heading};}
 step(low,{},[],external);
 assert(!low.events.some(e=>e.type==='ObstacleContact'||e.type==='TankContact'),'exactvalidL2 scene replay stayscontactfree');
 for(let i=0;i<low.enemies.length;i++){const e=low.enemies[i]!;travel[e.id]=(travel[e.id]??0)+Math.hypot(e.position.x-positions[i]!.x,e.position.z-positions[i]!.z);stationary[e.id]=Math.abs(e.speed)<.5?(stationary[e.id]??0)+1:0;maxStationary[e.id]=Math.max(maxStationary[e.id]??0,stationary[e.id]!);}
}
for(const e of low.enemies){assert((travel[e.id]??0)>4,'exactlowtierhull makesprogress');assert((maxStationary[e.id]??0)<90,'no persistent lowtier stationaryrun '+e.id);assert.equal(oscillationWindows[e.id]??0,0,'no lowdisplacement rapidreversingoscillation '+e.id);}
console.log('ExactL2 validspawn12sec travel',travel,'adjacentturnflips',flips,'max stationaryticks',maxStationary,'stationaryoscillation windows',oscillationWindows);
const stalled=read('scripts/tests/jev-scan-stall.json');const se=stalled.enemies.find(e=>e.id==='enemy-L5-2')!;const start={...se.position};const memory:TankMemory={seen:{}};let plan:TacticalPlan|undefined;
for(let tick=0;tick<180;tick++){
 if(tick%15===0){plan=buildCandidates(observeTank(stalled,se.id,memory),se.position).find(p=>p.strategy==='patrol'||p.strategy==='explore');assert(plan&&plan.id!=='scan','existingexpandedwallmargin allows safeoutwardpath');}
 const cmd=commandForPlan(stalled,se.id,{...plan!,fire:false,targetId:undefined,expiresTick:stalled.tick+30});const external:Parameters<typeof step>[3]={};for(const e of stalled.enemies)external[e.id]={command:e.id===se.id?cmd:{turn:0,thrust:0,fire:false,grenade:false},fireHeading:e.heading};stalled.projectiles=[];stalled.grenades=[];step(stalled,{},[],external);assert(!stalled.events.some(e=>e.type==='ObstacleContact'&&e.tankId===se.id),'marginescape keeps physicalwallclear');
}
assert(Math.hypot(se.position.x-start.x,se.position.z-start.z)>5,'realL5 scanstall escapes ratherthanrotatingforever');console.log('ExactL5 staticmargin recovered to',se.position);
// Caller motororigin is localonly: provider observation keeps ten-unit approximate ownGPS.
const local=createInitialState(2,[{loadout:{speed:10,shields:100,ammo:100}}]);local.enemies=[local.enemies[0]!];const e=local.enemies[0]!;e.position={x:3.8,z:0};local.obstacles=[{id:'coarseTrap',kind:'wall',min:{x:-1,z:-2},max:{x:1,z:2}}];e.heading=Math.PI/2;const observation=observeTank(local,e.id,{seen:{}});assert.deepEqual(observation.own.position,{x:0,z:0});assert(buildCandidates(observation,e.position).some(p=>p.id!=='scan'),'localmotorframe avoids impossiblecoarsegeometrytrap');
