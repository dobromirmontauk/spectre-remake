import assert from 'node:assert/strict';
import {createInitialState} from '../../src/sim/simulation.ts';
import {DEFAULT_LOADOUT} from '../../src/config/constants.ts';
import {applyMovement} from '../../src/sim/movement.ts';
import {movementParamsForEnemy} from '../../src/sim/ai.ts';
import {levelConfig} from '../../src/config/levels.ts';
import {observeTank} from '../../src/jev/observation.ts';
import {buildCandidates,commandForPlan} from '../../src/jev/controller.ts';
import type {TacticalPlan} from '../../src/jev/types.ts';
// Minimal pose/timing fixture from final b73d865 live ticks390..449.
// [tick, actually observed player x/z, accepted plan expiry]. No provider payloads.
const poses=[
 [390,19.719387074,36.992033025,399],
 [391,19.612785578,36.919586723,399],
 [392,19.46089242,36.836082753,399],
 [393,19.341425226,36.754892932,399],
 [394,19.245851471,36.689941075,399],
 [395,19.174171154,36.641227182,399],
 [396,19.059277612,36.578063922,399],
 [397,18.898160689,36.508342404,415],
 [398,18.769635709,36.437685198,415],
 [399,18.594242603,36.361785824,415],
 [400,18.452086186,36.283634672,415],
 [401,18.262416896,36.201557441,415],
 [402,18.106629042,36.115912344,415],
 [403,17.90268357,36.027657257,415],
 [404,17.733264278,35.934518213,415],
 [405,17.597255473,35.842086724,415],
 [406,17.485140106,35.7658932,415],
 [407,17.327404904,35.679177539,415],
 [408,17.121419976,35.590039901,415],
 [409,16.950053337,35.495830293,415],
 [410,16.812206574,35.40214973,415],
 [411,16.627208498,35.300446177,415],
 [412,16.476496037,35.198022095,415],
 [413,16.277866523,35.088824595,430],
 [414,16.114288365,34.977656994,430],
 [415,15.98415724,34.870003165,430],
 [416,15.876285386,34.780763806,430],
 [417,15.723734969,34.67709065,430],
 [418,15.59507799,34.589655458,430],
 [419,15.490314451,34.51845823,430],
 [420,15.40944435,34.463498966,430],
 [421,15.352467689,34.424777667,430],
 [422,15.319384466,34.402294332,430],
 [423,15.310194682,34.396048961,430],
 [424,15.310194682,34.396048961,430],
 [425,15.310194682,34.396048961,430],
 [426,15.310194682,34.396048961,430],
 [427,15.310194682,34.396048961,430],
 [428,15.310194682,34.396048961,430],
 [429,15.310194682,34.396048961,430],
 [430,15.310194682,34.396048961,430],
 [431,15.310194682,34.396048961,430],
 [432,15.310194682,34.396048961,430],
 [433,15.310194682,34.396048961,444],
 [434,15.271247718,34.374637686,444],
 [435,15.197729445,34.324674719,444],
 [436,15.087452035,34.249730269,444],
 [437,14.940415488,34.149804335,444],
 [438,14.756619805,34.024896918,444],
 [439,14.536064985,33.875008017,444],
 [440,14.278751029,33.700137633,444],
 [441,13.984677936,33.500285765,444],
 [442,13.653845706,33.275452414,444],
 [443,13.28625434,33.02563758,444],
 [444,12.909558977,32.714008073,444],
 [445,12.49861858,32.374048612,444],
 [446,12.103088449,32.046837631,444],
 [447,11.722968583,31.732375129,444],
 [448,11.358258981,31.430661107,463],
 [449,10.930015039,31.139626825,463],
] as const;
const state=createInitialState(5,[{loadout:DEFAULT_LOADOUT}]);state.obstacles=[];state.enemies=state.enemies.slice(1,3);
const shooter=state.enemies[1]!,ally=state.enemies[0]!;state.tick=390;
shooter.position={x:44.814110448748195,z:41.15058905803967};shooter.prevPosition={...shooter.position};shooter.heading=4.586725274241099;shooter.speed=0;
ally.position={x:31.694842945754136,z:38.72738053101003};ally.prevPosition={...ally.position};ally.speed=0;
state.players[0]!.position={x:20.267883823312307,z:37.31624330576902};state.players[0]!.speed=0;
const observation=observeTank(state,shooter.id,{seen:{}});
assert(observation.contacts.some(c=>c.id===ally.id&&c.team==='enemy'),'obstructing ally is personally known');
assert(!buildCandidates(observation,shooter.position).some(p=>p.id==='hold:player'),'fresh known ally blocks stationary hold');
assert(buildCandidates(observation,shooter.position).some(p=>p.id.startsWith('flank:')),'moving flank remains available');
const sharedAlly=structuredClone(observation);for(const c of sharedAlly.contacts)if(c.id===ally.id)c.source='shared';
assert(!buildCandidates(sharedAlly,shooter.position).some(p=>p.id==='hold:player'),'fresh shared ally is authorized lane knowledge');
const stale=structuredClone(observation);for(const c of stale.contacts)if(c.id===ally.id){c.seenTick=state.tick-60;c.ageSeconds=2;}
assert(buildCandidates(stale,shooter.position).some(p=>p.id==='hold:player'),'stale ally report does not veto current hold');
const privateMemory=structuredClone(observation);privateMemory.memory.push(privateMemory.contacts.find(c=>c.id===ally.id)!);privateMemory.contacts=privateMemory.contacts.filter(c=>c.id!==ally.id);
assert(buildCandidates(privateMemory,shooter.position).some(p=>p.id==='hold:player'),'memory-only ally does not claim current lane obstruction');
const unknown=structuredClone(observation);for(const c of unknown.contacts)if(c.id===ally.id)c.team=undefined;
assert(buildCandidates(unknown,shooter.position).some(p=>p.id==='hold:player'),'unknown affiliation does not invent friendly lane veto');
const shared=structuredClone(observation);for(const c of shared.contacts)if(c.id==='player')c.source='shared';
assert(!buildCandidates(shared,shooter.position).some(p=>p.id==='hold:player'),'shared opponent never enables stationary blind hold');
// Exercise the previously accepted hold even though it will now be excluded.
const history:{heading:number;turn:number}[]=[];let reversals=0,lastTurn=0;
for(const [tick,x,z,expiry]of poses){
 state.tick=tick;state.players[0]!.position={x,z};
 const plan:TacticalPlan={id:'hold:player',strategy:'protect',description:'Fixture known opposing tank',waypoint:{...shooter.position},lookAt:{x,z},targetId:'player',fire:true,expiresTick:expiry};
 const cmd=commandForPlan(state,shooter.id,plan);
 assert.equal(cmd.fire,false,'physical friendly-fire guard remains active');
 assert.equal(cmd.thrust,0,'recorded stationary hold does not invent translation');
 if(cmd.turn){if(lastTurn&&cmd.turn!==lastTurn)reversals++;lastTurn=cmd.turn;}
 history.push({heading:shooter.heading,turn:cmd.turn});
 applyMovement(shooter,cmd,movementParamsForEnemy(shooter.kind,levelConfig(5)));
}
assert.equal(reversals,0,'brief expired plans do not scan against the tracked target then reacquire');
console.log('Recorded60tick expiry window: zero turn reversals, zero unsafe shots');
const old:TacticalPlan={id:'hold:player',strategy:'protect',description:'Expired fixture',waypoint:{...shooter.position},lookAt:{x:-90,z:-90},targetId:'player',fire:true,expiresTick:state.tick-1};
assert.equal(commandForPlan(state,shooter.id,old).turn,0,'brief expiry preserves current aim rather than reading a hidden target');
const hiddenA=commandForPlan(state,shooter.id,old);state.players[0]!.position={x:-80,z:-70};const hiddenB=commandForPlan(state,shooter.id,old);
assert.deepEqual(hiddenB,hiddenA,'expired grace does not track hidden opposing coordinates');
state.tick=old.expiresTick+7;assert.equal(commandForPlan(state,shooter.id,old).turn,1,'grace is bounded then survey resumes');
assert.equal(commandForPlan(state,shooter.id,null).turn,1,'no prior plan retains normal fallback scan');
