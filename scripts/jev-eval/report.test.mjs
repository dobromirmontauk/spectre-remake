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
