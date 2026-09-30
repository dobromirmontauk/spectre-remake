import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRun } from './report.mjs';
const run = { config:{enabled:true}, samples:[], network:{requested:2,responses:1,httpFailures:1,transportFailures:1},errors:[],elapsedSeconds:1,stoppedReason:'duration' };
test('failed or requested calls do not imply model decisions', () => {
 const result = summarizeRun(run);
 assert.equal(result.inferenceEvidence,'no-model-decisions-observed');
 assert.equal(result.network.requested,2); assert.equal(result.network.httpFailures,1); assert.equal(result.network.transportFailures,1);
 assert.ok(result.unavailableKPIs.includes('wallHits'));
});
test('reports measured decisions and counters without inferring missing ones', () => {
 const result = summarizeRun({...run,samples:[{metrics:{decisionsApplied:4,wallHits:0},state:{players:[],enemies:[],level:1}}],elapsedSeconds:2});
 assert.equal(result.inferenceEvidence,'model-decisions-observed');assert.equal(result.effectiveDecisionsPerSecond,2);
 assert.ok(!result.unavailableKPIs.includes('wallHits'));
});
test('baseline never claims model inference', () => {
 assert.equal(summarizeRun({...run,config:{enabled:false},samples:[{metrics:{decisions:10}}]}).inferenceEvidence,'no-model-decisions-observed');
});
import { safeHttpFailure, sampledKPIs } from './sampled.mjs';
test('command coverage uses model plus fallback command counts', () => {
 const r=summarizeRun({...run,samples:[{metrics:{modelCommandTicks:90,fallbackTicks:30,observedTicks:10,acceptedHzPerTank:1.7}}]});
 assert.equal(r.modelDrivenTickFraction,0.75);assert.equal(r.effectiveAcceptedHzPerTank,1.7);
});
test('sampled recoveries exclude death resets and respawn teleports', () => {
 const sample=(time,x,shield,lives=3,alive=true)=>({elapsedSeconds:time,state:{level:1,players:[{id:'player',position:{x,z:0},shield,maxShield:100,lives,alive}]}});
 const r=sampledKPIs([sample(0,0,20),sample(0.2,1,70),sample(0.4,2,20),sample(0.6,100,100,2)]).tanks.player;
 assert.equal(r.lowShieldEpisodes,2);assert.equal(r.lowShieldRecoveries,1);assert.equal(r.distance,2);
});
test('HTTP diagnostics cannot expose arbitrary body text or credential codes', () => {
 assert.deepEqual(safeHttpFailure(500,'{"code":"sk-secret", "error":"Bearer SECRET"}'),{status:500,code:null,bodyOmitted:true});
 assert.equal(safeHttpFailure(429,'{"code":"rate_limited"}').code,'rate_limited');
});
