import assert from 'node:assert/strict';
import {createInitialState,step} from '../../src/sim/simulation.ts';
import {DEFAULT_LOADOUT} from '../../src/config/constants.ts';
import {observeTank} from '../../src/jev/observation.ts';
import {buildCandidates,commandForPlan} from '../../src/jev/controller.ts';
const state=createInitialState(3,[{loadout:DEFAULT_LOADOUT}]);state.obstacles=[];state.enemies=[state.enemies[0]!];
const tank=state.enemies[0]!;tank.position={x:0,z:0};tank.prevPosition={...tank.position};tank.heading=0;tank.speed=0;
const player=state.players[0]!;player.position={x:0,z:25};player.prevPosition={...player.position};player.invulnerableTicks=9999;
const observed=observeTank(state,tank.id,{seen:{}});observed.recentThreat={kind:'projectile',tick:0,seconds:0,ageSeconds:0};observed.mission={id:'recover-test',kind:'recover',role:'support',assignedTick:0,reviewTick:120,waypoint:{x:0,z:-18},targetId:'player',track:{position:{x:0,z:25},heading:0,seenTick:0,ageSeconds:0,uncertainty:4},reason:'Withdraw from visible threat'};
const plan=buildCandidates(observed,tank.position).find(p=>p.backing);
assert(plan,'recovery offers gun-facing reverse withdrawal');
const initialGap=25;let shots=0;
for(let i=0;i<15;i++){
 const cmd=commandForPlan(state,tank.id,{...plan,expiresTick:state.tick+30});assert.equal(cmd.turn,0,'withdrawal keeps gun on own visible target');assert(cmd.thrust<0,'withdrawal moves away rather than exposed hold');
 step(state,{},[],{[tank.id]:{command:cmd,fireHeading:tank.heading}});shots+=state.events.filter(e=>e.type==='ShotFired'&&e.ownerId===tank.id).length;
 assert(!state.events.some(e=>e.type==='TankContact'||e.type==='ObstacleContact'||e.type==='FriendlyFireHit'));
}
assert(player.position.z-tank.position.z>initialGap+1,'withdrawal increases separation');assert(shots>0,'safe fire occurs during moving withdrawal');
const critical=structuredClone(observed);critical.own.shieldFraction=1/3;
assert(buildCandidates(critical,{x:0,z:0}).every(p=>p.tactic!=='fire'),'critical tank keeps moving cover instead of idle exposed fire');
const shared=structuredClone(observed);shared.contacts.find(c=>c.id==='player')!.source='shared';assert(!buildCandidates(shared,{x:0,z:0}).some(p=>p.backing),'reported enemy cannot enable gun tracking withdrawal');
const wall=structuredClone(observed);wall.geometry=[{id:'behind',kind:'wall',min:{x:-3,z:-10},max:{x:3,z:-5}}];assert(!buildCandidates(wall,{x:0,z:0}).some(p=>p.backing),'reverse option is not offered through visible wall');
player.position={x:0,z:-25};tank.position={x:0,z:0};tank.heading=0;tank.speed=0;const hidden=commandForPlan(state,tank.id,{...plan,expiresTick:state.tick+30});assert.equal(hidden.fire,false,'lost own sight never shoots hidden target');
console.log('Reversewithdrawal15ticks increases gap and fires; critical, shared, hidden and wall safeguards pass');
// Explicit reverse commands retain the existing stopping/bounds/body/shot guards.
const guarded=createInitialState(3,[{loadout:DEFAULT_LOADOUT}]);guarded.obstacles=[];guarded.enemies=[guarded.enemies[0]!];const defender=guarded.enemies[0]!;defender.position={x:0,z:0};defender.prevPosition={...defender.position};defender.heading=0;defender.speed=0;guarded.players[0]!.position={x:0,z:25};
const friendly={...defender,id:'friendly',position:{x:0,z:10},prevPosition:{x:0,z:10}};guarded.enemies.push(friendly);
assert.equal(commandForPlan(guarded,defender.id,{...plan,waypoint:{x:0,z:-14}}).fire,false,'reverse withdrawal never fires through teammate');
guarded.enemies=[defender];defender.position={x:0,z:-94};defender.prevPosition={...defender.position};defender.speed=-10;guarded.players[0]!.position={x:0,z:-65};
for(let tick=0;tick<90;tick++){const command=commandForPlan(guarded,defender.id,{...plan,waypoint:{x:0,z:-110},fire:false,expiresTick:guarded.tick+30});step(guarded,{},[],{[defender.id]:{command,fireHeading:defender.heading}});assert(!guarded.events.some(e=>e.type==='ObstacleContact'||e.type==='TankContact'));}
assert(defender.position.z>-98.4,'reverse braking preserves arena containment');
console.log('Explicit reverse ally-fire and90tick arena stop guards pass');
