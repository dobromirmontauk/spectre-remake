import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {createJevServer,validateRequest} from './server.mjs';
import {RESERVATION_USD} from './budget.mjs';
const tank=(tankId=1,role='enemy')=>({tankId,role,observation:{visibleTargets:[],privateMarker:tankId},candidates:[{id:'hold',description:'Hold safe position'}]});
const body=(tanks=[tank()])=>({version:1,sequence:2,tick:30,tanks});
function success(){return new Response(JSON.stringify({answers:{tank_0:{type:'choice',choice:'hold',confidence:1,probabilities:{hold:1}}},usage:{input_tokens:100}}));}
async function fixture(options,fn){const dir=mkdtempSync(join(tmpdir(),'jev-http-'));const {server,budget}=createJevServer({apiKey:'FAKE',ledgerFile:join(dir,'spend.json'),...options});server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;try{await fn(url,budget);}finally{server.close();server.closeAllConnections();await once(server,'close');rmSync(dir,{recursive:true,force:true});}}
const post=(url,b=body(),headers={})=>fetch(url+'/api/jev/decide',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(b)});
test('three enemies plus one player accepted, fifth or fourth enemy rejected',()=>{validateRequest(body([tank(1),tank(2),tank(3),tank(4,'player')]));assert.throws(()=>validateRequest(body([tank(1),tank(2),tank(3),tank(4)])));assert.throws(()=>validateRequest(body([tank(1),tank(2),tank(3),tank(4,'player'),tank(5)])));});
test('isolated commander perspectives, <=two upstream in flight, normalized decisions and spend',async()=>{let count=0,active=0,max=0;await fixture({fetchImpl:async(_url,opts)=>{count++;active++;max=Math.max(max,active);const p=JSON.parse(opts.body);assert.equal(Object.keys(p.state.observations).length,1);assert.match(p.questions.tank_0.instructions,/You command tank/);await new Promise(r=>setTimeout(r,10));active--;return success();}},async(url,budget)=>{const res=await post(url,body([tank(1),tank(2),tank(3),tank(4,'player')]));assert.equal(res.status,200);const r=await res.json();assert.equal(r.decisions.length,4);assert.equal(r.usage.inputTokens,400);assert.equal(count,4);assert.equal(max,2);assert.ok(Math.abs(budget.spentUsd-400*.042/1e6)<1e-12);});});
test('timeout conservatively charges reservation and budget blocks further paid requests',async()=>{let count=0;await fixture({timeoutMs:10,limitUsd:RESERVATION_USD,fetchImpl:async()=>{count++;return new Promise(()=>{});}},async(url,budget)=>{assert.equal((await post(url)).status,504);assert.equal(budget.spentUsd,RESERVATION_USD);assert.equal((await post(url)).status,402);assert.equal(count,1);});});
test('bad upstream choice/error retains max reservation; keys never sent to client',async()=>{await fixture({fetchImpl:async()=>new Response(JSON.stringify({answers:{},usage:{input_tokens:100}}))},async(url,budget)=>{const r=await post(url);assert.equal(r.status,502);assert.equal(budget.spentUsd,RESERVATION_USD);assert.ok(!(await r.text()).includes('FAKE'));});});
test('untrusted origins and oversized/fifth-tank requests never call provider',async()=>{let calls=0;await fixture({fetchImpl:async()=>{calls++;return success();}},async url=>{assert.equal((await post(url,body(),{Origin:'https://evil.example'})).status,403);assert.equal((await post(url,body([tank(1),tank(2),tank(3),tank(4),tank(5)]))).status,400);assert.equal(calls,0);const r=await fetch(url+'/health',{headers:{Origin:'http://localhost:5173'}});assert.equal(r.headers.get('access-control-allow-origin'),'http://localhost:5173');assert.equal((await r.json()).available,true);});});

import {buildCandidates} from '../src/jev/controller.ts';
test('actual frontend-built flag/engage/flank action IDs survive backend wire contract',async()=>{
 const observation={own:{id:'player-1',team:'player',position:{x:0,z:0},heading:0,speed:0,shieldFraction:1,ammo:100,fireReady:true,tick:30},contacts:[{id:'flag-3',kind:'flag',position:{x:0,z:25},seenTick:30},{id:'enemy-2',kind:'tank',team:'enemy',position:{x:10,z:30},seenTick:30}],memory:[],visited:[],geometry:[],bounds:160};
 const candidates=buildCandidates(observation).map(({id,description})=>({id,description}));
 assert.ok(candidates.some(c=>c.id==='flag:flag-3'));assert.ok(candidates.some(c=>c.id==='engage:enemy-2'));assert.ok(candidates.some(c=>c.id==='flank:enemy-2:-1'));
 await fixture({fetchImpl:async(_url,opts)=>{const p=JSON.parse(opts.body);const criteria=p.questions.tank_0.criteria;assert.ok(criteria['flag:flag-3']);return new Response(JSON.stringify({answers:{tank_0:{type:'choice',choice:'flag:flag-3',confidence:1,probabilities:Object.fromEntries(Object.keys(criteria).map(id=>[id,id==='flag:flag-3'?1:0]))}},usage:{input_tokens:100}}));}},async url=>{const res=await post(url,body([{tankId:'player-1',role:'player',observation,candidates}]));assert.equal(res.status,200);assert.equal((await res.json()).decisions[0].choice,'flag:flag-3');});
});
test('candidate IDs remain length bounded and reject unsafe punctuation',()=>{for(const actionId of ['x'.repeat(65),'flag:bad/key','flag:bad key','flag:bad"key']){const t=tank();t.candidates=[{id:actionId,description:'invalid'}];assert.throws(()=>validateRequest(body([t])));}});
