import assert from 'node:assert/strict';
import {createInitialState,step} from '../../src/sim/simulation.ts';
import {DEFAULT_LOADOUT} from '../../src/config/constants.ts';
import {commandForPlan} from '../../src/jev/controller.ts';
import {JevSession} from '../../src/game/jev-session.ts';
import type {TacticalPlan} from '../../src/jev/types.ts';
// Minimal actual pair poses/patrol waypoints at latest live tick1860.
// No provider payload or observation export is included.
const state=createInitialState(5,[{loadout:DEFAULT_LOADOUT}]);state.obstacles=[];state.enemies=[state.enemies[0]!,state.enemies[2]!];state.players[0]!.position={x:0,z:0};
const session=new JevSession();session.configure({enabled:true});session.enforceRoster(state);
const [a,b]=state.enemies;
a!.position={x:80.02860335503034,z:-82.40441976928426};a!.prevPosition={...a!.position};a!.heading=-9.236282401553966;a!.speed=-1.866666666666665;
b!.position={x:79.05666378854848,z:-88.79200506025705};b!.prevPosition={...b!.position};b!.heading=-6.220353454107782;b!.speed=2.666666666666669;
state.tick=1860;
const plans:Record<string,TacticalPlan>={
 [a!.id]:{id:'patrol:flag-5:1',strategy:'patrol',description:'Recorded clockwise patrol',waypoint:{x:67.4606738026403,z:-95.93607354035481},fire:false,expiresTick:9999},
 [b!.id]:{id:'patrol:flag-5:-1',strategy:'patrol',description:'Recorded counterclockwise patrol',waypoint:{x:71.64632868763871,z:-74.46425620742743},fire:false,expiresTick:9999}
};
(session as unknown as {plans:Record<string,TacticalPlan>}).plans=plans;
const originalState=state,history:Record<string,{x:number;z:number;h:number;turn:number}[]>={},travel:Record<string,number>={},windows:Record<string,number>={};
for(let tick=0;tick<180;tick++){
 const positions=state.enemies.map(e=>({...e.position}));const issued=session.commands(state,true)!;
 assert.equal(state,originalState,'actual app uses the same in-place simulation object');
 for(const tank of state.enemies){const cmd=issued.enemies[tank.id]!.command;assert.equal(cmd.fire,false);
 const h=history[tank.id]??=[];h.push({x:tank.position.x,z:tank.position.z,h:tank.heading,turn:cmd.turn});if(h.length>60)h.shift();
 if(h.length===60){const signs=h.filter(x=>x.turn).map(x=>x.turn),flips=signs.filter((x,i)=>i>0&&x!==signs[i-1]).length;const first=h[0]!,last=h[59]!;
 if(flips>=4&&Math.abs(first.h-last.h)<.15&&Math.hypot(first.x-last.x,first.z-last.z)<1)windows[tank.id]=(windows[tank.id]??0)+1;}}
 step(state,{},[],issued.enemies);
 assert(!state.events.some(e=>e.type==='TankContact'||e.type==='ObstacleContact'||e.type==='FriendlyFireHit'),'actual session paired recovery keeps physical safety');
 for(let i=0;i<state.enemies.length;i++){const e=state.enemies[i]!;travel[e.id]=(travel[e.id]??0)+Math.hypot(e.position.x-positions[i]!.x,e.position.z-positions[i]!.z);}
}
console.log('Actual session pair180ticks travel',travel,'stationary jitterwindows',windows);
for(const tank of state.enemies){assert((travel[tank.id]??0)>8,'both tanks move instead of indefinite yielding');assert.equal(windows[tank.id]??0,0,'spacing boundary does not create stationary motor chatter');}

// Local motor recovery is bounded and cannot bleed into a different lifecycle.
const setup=()=>{const s=createInitialState(5,[{loadout:DEFAULT_LOADOUT}]);s.obstacles=[];s.enemies=[s.enemies[0]!];s.players[0]!.position={x:50,z:50};const t=s.enemies[0]!;t.position={x:0,z:0};t.heading=0;t.speed=0;
const other={...t,id:'nearbyAlly',position:{x:0,z:5},prevPosition:{x:0,z:5}};s.enemies.push(other);return {s,t,other,p:{id:'explore:test',description:'Local test',waypoint:{x:20,z:0},fire:false,expiresTick:10000} as TacticalPlan};};
const freshCommand=(s:typeof state,id:string,p:TacticalPlan)=>commandForPlan(JSON.parse(JSON.stringify(s)),id,p);
for(const reset of ['level','rollback','gap','death'] as const){const {s,t,p}=setup();s.tick=100;commandForPlan(s,t.id,p);t.heading=Math.PI;
 if(reset==='level'){s.level++;s.tick++;}else if(reset==='rollback')s.tick=99;else if(reset==='gap')s.tick+=2;else{t.alive=false;commandForPlan(s,t.id,p);t.alive=true;s.tick++;}
 assert.deepEqual(commandForPlan(s,t.id,p),freshCommand(s,t.id,p),'recovery resets for '+reset);}
const bounded=setup();for(let tick=0;tick<120;tick++){bounded.s.tick=tick;commandForPlan(bounded.s,bounded.t.id,bounded.p);}bounded.s.tick=120;bounded.t.heading=Math.PI;
assert.deepEqual(commandForPlan(bounded.s,bounded.t.id,bounded.p),freshCommand(bounded.s,bounded.t.id,bounded.p),'recovery direction has bounded120tick lifetime');
const released=setup();commandForPlan(released.s,released.t.id,released.p);released.s.tick++;released.other.position={x:0,z:12};
assert.deepEqual(commandForPlan(released.s,released.t.id,released.p),freshCommand(released.s,released.t.id,released.p),'safe release distance restores planned movement');
console.log('Spacing release, identity, lifecycle, rollback and bounded-duration checks passed');
