import assert from 'node:assert/strict';
import {JevSession} from '../src/game/jev-session.ts';
import {createInitialState} from '../src/sim/simulation.ts';
import {DEFAULT_LOADOUT} from '../src/config/constants.ts';
for(const raw of ['null','not valid JSON',JSON.stringify({usage:{inputTokens:123},spentUsd:5,decisions:null}),JSON.stringify({sequence:1,tick:0,decisions:[null],usage:{inputTokens:500}})]){
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return new Response(raw);};const j=new JevSession(fetcher,()=>0.7);const state=createInitialState(3,[{loadout:DEFAULT_LOADOUT}]);j.configure({enabled:true});j.update(state,0,true,true,true);await new Promise(r=>setTimeout(r,0));const stats=j.getStats();assert.equal(stats.failures,1);assert.equal(stats.modelDecisions,0);assert.equal(stats.inputTokens,0);assert.equal(stats.spentUsd,0);assert.match(stats.status,/Invalid decision response/);const audit=j.getDecisionLog()[0]!;assert.equal(audit.outcome,'failed');assert.equal(audit.error,'Invalid decision response');if(raw==='null')assert.equal(audit.response,null);if(raw==='not valid JSON')assert.equal((audit as {responseText?:string}).responseText,raw);assert.equal(audit.decisions.length,0);const commands=j.commands(state,true)!;assert.ok(Object.keys(commands.enemies).length>0);assert.equal(j.getStats().modelCommandTicks,0);assert.equal(calls,1);j.configure({enabled:false});
}
console.log('Malformed HTTP200 envelopes fail safely before counters, preserve audit data and retain offline guards');
