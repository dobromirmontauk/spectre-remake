import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRng} from '../../src/sim/rng.ts';
import {step} from '../../src/sim/simulation.ts';
import {buildCandidates,commandForPlan} from '../../src/jev/controller.ts';
import {observeTank} from '../../src/jev/observation.ts';
import type {GameState} from '../../src/sim/types.ts';
import type {TacticalPlan} from '../../src/jev/types.ts';
const recorded=JSON.parse(readFileSync('scripts/tests/jev-crowding-recorded.json','utf8')) as {state:GameState;plans:Record<string,TacticalPlan>;updates:{tick:number;plans:Record<string,TacticalPlan>}[]};
const state=recorded.state;state.rng=createRng(state.rng.state);state.projectiles=[];state.grenades=[];
for(let tick=0;tick<180;tick++){
 for(const update of recorded.updates)if(update.tick===state.tick)recorded.plans=update.plans;
 const external:Parameters<typeof step>[3]={};let playerCommand;
 for(const tank of [...state.players,...state.enemies]){
 const accepted=recorded.plans[tank.id];const plan=accepted?{...accepted,fire:false,expiresTick:state.tick+30}:null;
 const command=commandForPlan(state,tank.id,plan);command.fire=false;
 if(state.players.includes(tank as never))playerCommand=command;else external[tank.id]={command,fireHeading:tank.heading};
 }
 step(state,{player:playerCommand!},[],external);
 assert(!state.events.some(e=>e.type==='TankContact'),'recorded converging interception stays contact-free at tick '+state.tick);
}
console.log('Recorded joint crowding replay180ticks has zero tank contacts');
const jitter=JSON.parse(readFileSync('scripts/tests/jev-jitter-recorded.json','utf8')) as {state:GameState;plans:Record<string,TacticalPlan>;trackedId:string};
jitter.state.rng=createRng(jitter.state.rng.state);jitter.state.projectiles=[];jitter.state.grenades=[];
const history:{position:{x:number;z:number};heading:number;turn:number}[]=[];let oscillations=0;
for(let tick=0;tick<180;tick++){
 const external:Parameters<typeof step>[3]={};let playerCommand;
 for(const tank of [...jitter.state.players,...jitter.state.enemies]){
 const plan=jitter.plans[tank.id];const command=commandForPlan(jitter.state,tank.id,plan?{...plan,fire:false,expiresTick:jitter.state.tick+30}:null);command.fire=false;
 if(tank.id===jitter.trackedId){history.push({position:{...tank.position},heading:tank.heading,turn:command.turn});if(history.length>60)history.shift();
 if(history.length===60){const signs=history.filter(x=>x.turn).map(x=>x.turn);const flips=signs.filter((x,i)=>i>0&&x!==signs[i-1]).length;const first=history[0]!,last=history[59]!;
 if(flips>=4&&Math.abs(first.heading-last.heading)<.15&&Math.hypot(first.position.x-last.position.x,first.position.z-last.position.z)<1)oscillations++;}}
 if(state.players.some(p=>p.id===tank.id))playerCommand=command;else external[tank.id]={command,fireHeading:tank.heading};
 }
 step(jitter.state,{player:playerCommand!},[],external);
}
assert.equal(oscillations,0,'recorded stationary steering oscillation does not recur');
console.log('Recorded stationary jitter fixture180ticks zero oscillation windows');
// Tactical occupancy uses only commander contacts, never hidden world bodies.
const commander=state.enemies[0]!;const observation=observeTank(state,commander.id,{seen:{}});
observation.contacts=[{id:'seenOpponent',kind:'tank',team:'player',source:'own',position:{x:commander.position.x+25,z:commander.position.z},seenTick:state.tick}];
const engage=buildCandidates(observation,commander.position).find(p=>p.id==='engage:seenOpponent')!;assert(engage);
observation.contacts.push({id:'knownAlly',kind:'tank',team:'enemy',position:{...engage.waypoint},seenTick:state.tick,source:'shared'});
assert(!buildCandidates(observation,commander.position).some(p=>p.id==='engage:seenOpponent'),'known teammate occupied attack destination is excluded');
assert(buildCandidates(observation,commander.position).some(p=>p.id.startsWith('flank:')),'free flank remains available');
