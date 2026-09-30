import { createServer } from 'node:http';
import { readFileSync, createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Audit } from './audit.mjs';
import { Budget, MAX_INPUT_TOKENS, RESERVATION_USD } from './budget.mjs';
const BODY_LIMIT=65536;
const PROVIDER_PAYLOAD_LIMIT=32768;
const fail=(status,message)=>Object.assign(new Error(message),{status});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>(typeof x==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x))||(Number.isSafeInteger(x)&&x>=0);
export function validateRequest(body){
 if(!plain(body)||body.version!==1||!Number.isSafeInteger(body.sequence)||body.sequence<0||!Number.isSafeInteger(body.tick)||body.tick<0||!Array.isArray(body.tanks)||body.tanks.length<1||body.tanks.length>4)throw fail(400,'invalid decision request');
 let enemies=0,players=0;const ids=new Set();
 for(const t of body.tanks){
  if(!plain(t)||!id(t.tankId)||ids.has(String(t.tankId))||!['enemy','player'].includes(t.role)||!plain(t.observation)||JSON.stringify(t.observation).length>6000||!Array.isArray(t.candidates)||!t.candidates.length||t.candidates.length>16)throw fail(400,'invalid tank');
  ids.add(String(t.tankId));t.role==='enemy'?enemies++:players++;
  const choices=new Set();for(const c of t.candidates){if(!plain(c)||typeof c.id!=='string'||!/^[a-zA-Z0-9_:-]{1,64}$/.test(c.id)||choices.has(c.id)||typeof c.description!=='string'||!c.description.length||c.description.length>512)throw fail(400,'invalid candidate');choices.add(c.id);}
 }
 if(enemies>3||players>1)throw fail(400,'maximum three enemies and one player');
 return body;
}
function personalityInstruction(tank){
 if(tank.role==='player')return '';
 const profile=tank.observation.own?.personality;
 if(profile==='aggressive')return 'Commander personality: aggressive. Among feasible options prefer purposeful pressure, interception and flanking over passive defense; accept moderate exposure when healthy to stop flag capture. Never override recent-fire fear, low-shield survival, collision or friendly-fire constraints.';
 if(profile==='cowardly')return 'Commander personality: cowardly. Among feasible options prefer low-exposure cover, safer flanking and defensive standoff; withdraw sooner under credible danger, then patrol safely rather than idle. Your flag-defense mission still matters. Never override collision or friendly-fire constraints.';
 return 'Commander personality: neutral. Balance pressure and defense, choosing purposeful interception or patrol when safe and survival under credible danger. Never override recent-fire fear, low-shield survival, collision or friendly-fire constraints.';
}
export function providerRequest(body){
 const observations=Object.fromEntries(body.tanks.map(t=>[String(t.tankId),t.observation]));
 const questions=Object.fromEntries(body.tanks.map((t,i)=>['tank_'+i,{type:'choice',instructions:`You command tank ${JSON.stringify(t.tankId)}. Use ONLY observations[${JSON.stringify(String(t.tankId))}], your tank's perception; other tanks' observations are unavailable to you. Pick the best available maneuver for the next 500 milliseconds. Preserve your tank, avoid barriers and tank collisions, never fire through teammates, avoid ineffective chasing, use safe cover and firing lanes. ${t.role==='player'?'Collect flags and survive while fighting enemies.':'Your mission is to STOP the opposing tank from taking your flags; do not fail this mission. Use remainingFlags and totalFlags in your own observation as the public objective score. As fewer flags remain, increase urgency: prioritize interception and active flag defense, especially when remainingFlags is 2 or less. Use visible or previously observed opponent positions and known flag routes only; never invent hidden targets. Challenge observed opposing players with purposeful attacks and flanks. When opponents are unseen and you are healthy, patrol known flags or explore unvisited sectors; peaceful regrouping or idling without a tactical reason wastes the defense window. Under recent fire or low shields, survival, cover, retreat and regrouping remain valid ways to protect the mission; avoid suicidal charging. Choose feasible purposeful movement and safe firing lanes rather than repetitive chasing.'} ${personalityInstruction(t)} Candidate descriptions specify validated local outcomes. Prefer progress toward your objective over idle behavior unless holding or retreating is tactically necessary.`,criteria:Object.fromEntries(t.candidates.map(c=>[c.id,c.description]))}]));
 // Caller supplies one tank at a time, isolating perception at the provider boundary.
 return {model:'jev-1.13.0',state:{observations},questions};
}
export function normalizeAnswers(body,result){
 if(!plain(result)||!plain(result.answers)||!plain(result.usage)||!Number.isSafeInteger(result.usage.input_tokens)||result.usage.input_tokens<0||result.usage.input_tokens>MAX_INPUT_TOKENS)throw fail(502,'invalid upstream response');
 return body.tanks.map((t,i)=>{const a=result.answers['tank_'+i];const choices=t.candidates.map(c=>c.id);if(!plain(a)||a.type!=='choice'||!choices.includes(a.choice)||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1||!plain(a.probabilities)||choices.some(c=>!Number.isFinite(a.probabilities[c])||a.probabilities[c]<0||a.probabilities[c]>1)||Object.keys(a.probabilities).some(c=>!choices.includes(c))||Math.abs(Object.values(a.probabilities).reduce((s,v)=>s+v,0)-1)>0.02)throw fail(502,'invalid upstream choice');return {tankId:t.tankId,choice:a.choice,confidence:a.confidence,probabilities:a.probabilities};});
}
function localOrigin(origin){try{const u=new URL(origin);return u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash;}catch{return false;}}
async function readBody(req,limit=BODY_LIMIT){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>limit)throw fail(413,'request too large');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'invalid JSON');}}
export function createJevServer({apiKey='',ledgerFile,fetchImpl=globalThis.fetch,timeoutMs=1500,limitUsd=9.5,auditFile=ledgerFile+'.calls.jsonl',auditFactory=file=>new Audit(file)}={}){
 const budget=new Budget(ledgerFile,{limitUsd});let audit;try{audit=auditFactory(auditFile);}catch(e){budget.close();throw e;}let active=0;let calls=[];let upstreamActive=0;const waiters=[];
 const acquire=async()=>{if(upstreamActive>=2)await new Promise(r=>waiters.push(r));else upstreamActive++;};
 const release=()=>{if(waiters.length)waiters.shift()();else upstreamActive--;};
 const server=createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   const origin=req.headers.origin;if(origin&&!localOrigin(origin))throw fail(403,'localhost origins only');
   // Block browser navigation/simple requests and non-local Host DNS rebinding.
   if(!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host??''))throw fail(403,'localhost host only');
   if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
   if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204);res.end();return;}
   if(req.method==='GET'&&['/health','/api/jev/health'].includes(req.url)){send(200,{available:!!apiKey,spentUsd:budget.spentUsd,limitUsd,model:'jev-1.13.0',attemptedCalls:budget.data.calls,pendingReservations:budget.pending.size,auditAvailable:audit.healthy,auditRecords:audit.index.length});return;}
   const route=new URL(req.url,'http://localhost');
   if(req.method==='GET'&&route.pathname==='/api/jev/history/export'){res.writeHead(200,{'Content-Type':'application/x-ndjson','Content-Disposition':'attachment; filename="jev-call-history.jsonl"','Cache-Control':'no-store'});const stream=createReadStream(audit.file);stream.on('error',()=>res.destroy());stream.pipe(res);return;}
   if(req.method==='GET'&&route.pathname==='/api/jev/history'){
    const offset=Number(route.searchParams.get('offset')??0),limit=Number(route.searchParams.get('limit')??50),callId=route.searchParams.get('callId');
    if(callId!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(callId))throw fail(400,'invalid call ID');
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw fail(400,'invalid history pagination');send(200,audit.page(offset,limit,callId));return;
   }
   if(req.method==='POST'&&route.pathname==='/api/jev/audit/browser'){
    if(!(req.headers['content-type']??'').startsWith('application/json'))throw fail(415,'JSON required');
    const b=await readBody(req,65536);if(!plain(b)||typeof b.browserSessionId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(b.browserSessionId)||!Number.isSafeInteger(b.sequence)||b.sequence<0||!Number.isSafeInteger(b.tick)||b.tick<0||!['attempt','response','outcome','applied'].includes(b.event)||typeof b.at!=='string'||!Number.isFinite(Date.parse(b.at))||!plain(b.details)||Buffer.byteLength(JSON.stringify(b))>65536)throw fail(400,'invalid browser audit event');
    const record=audit.append({type:'browser',browserSessionId:b.browserSessionId,sequence:b.sequence,tick:b.tick,event:b.event,at:b.at,details:b.details});send(200,{recordId:record.recordId});return;
   }
   if(req.method!=='POST'||req.url!=='/api/jev/decide')throw fail(404,'not found');
   if(!(req.headers['content-type']??'').startsWith('application/json'))throw fail(415,'JSON required');
   if(!audit.healthy)throw fail(503,'audit unavailable');
   if(!apiKey)throw fail(503,'Jev key not configured');
   if(active>=2)throw fail(429,'too many in-flight requests');
   const now=Date.now();calls=calls.filter(t=>now-t<1000);if(calls.length>=6)throw fail(429,'local rate limit');calls.push(now);
   active++;
   try{
    const body=validateRequest(await readBody(req));
    const results=await Promise.all(body.tanks.map(async(t)=>{
     // One tank per provider call: shared-state batching would reveal another tank's vision.
     const one={...body,tanks:[t]};const payload=providerRequest(one);
     if(Buffer.byteLength(JSON.stringify(payload))>PROVIDER_PAYLOAD_LIMIT)throw fail(413,'upstream payload too large');
     await acquire();
     const callId=randomUUID(),started=Date.now();const meta={callId,sequence:body.sequence,tick:body.tick,tankId:t.tankId};
     let reservation;try{if(!audit.healthy)throw fail(503,'audit unavailable');audit.append({...meta,type:'request',payload,reservedCostUsd:RESERVATION_USD});reservation=budget.reserve();}catch(e){release();if(audit.healthy)audit.append({...meta,type:'error',error:e.status?'audit unavailable':'budget exhausted or reservation failed',durationMs:Date.now()-started,costUsd:0});throw fail(!audit.healthy?503:(e.status??402),!audit.healthy?'audit unavailable':'Jev test budget exhausted');}
     const controller=new AbortController();let timer;
     const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail(504,'Jev request timed out'));},timeoutMs);});
     try{
      const result=await Promise.race([(async()=>{const upstream=await fetchImpl('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});if(!upstream.ok)throw fail(502,'Jev upstream rejected request');const text=await upstream.text();if(Buffer.byteLength(text)>65536)throw fail(502,'upstream response too large');try{return JSON.parse(text);}catch{throw fail(502,'invalid upstream JSON');}})(),timeout]);
      const decisions=normalizeAnswers(one,result);const costUsd=budget.settle(reservation,result.usage.input_tokens);audit.append({...meta,type:'result',...decisions[0],usage:result.usage,costUsd,spentUsd:budget.spentUsd,durationMs:Date.now()-started});return {decision:{...decisions[0],callId},inputTokens:result.usage.input_tokens,costUsd};
     }catch(e){if(audit.healthy)audit.append({...meta,type:'error',error:e.status?e.message:'upstream failure',durationMs:Date.now()-started,costUsd:budget.pending.has(reservation)?RESERVATION_USD:0,spentUsd:budget.spentUsd});throw e;}finally{clearTimeout(timer);release();}
    }));
    const costUsd=results.reduce((s,r)=>s+r.costUsd,0);const inputTokens=results.reduce((s,r)=>s+r.inputTokens,0);
    send(200,{sequence:body.sequence,tick:body.tick,decisions:results.map(r=>r.decision),usage:{inputTokens,costUsd},costUsd,spentUsd:budget.spentUsd});
   }finally{active--;}
  }catch(e){send(e.status??500,{error:e.status?e.message:'backend unavailable',spentUsd:budget.spentUsd});}
 });
 server.on('close',()=>{audit.close();budget.close();});return {server,budget,audit};
}
export function loadApiKey(env=process.env){
 if(env.TYPESAFE_API_KEY)return env.TYPESAFE_API_KEY;
 if(!env.JEV_ENV_FILE)return '';
 const text=readFileSync(env.JEV_ENV_FILE,'utf8');const line=text.split(/\r?\n/).find(x=>/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=/.test(x));if(!line)return '';let key=line.slice(line.indexOf('=')+1).trim();if((key[0]==='"'&&key.at(-1)==='"')||(key[0]==="'"&&key.at(-1)==="'"))key=key.slice(1,-1);return key;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(!process.env.JEV_LEDGER_FILE)throw new Error('Set absolute JEV_LEDGER_FILE to the persistent test ledger');const {server}=createJevServer({apiKey:loadApiKey(),ledgerFile:process.env.JEV_LEDGER_FILE,auditFile:process.env.JEV_AUDIT_FILE??process.env.JEV_LEDGER_FILE+'.calls.jsonl'});server.listen(Number(process.env.JEV_PORT??8787),'127.0.0.1',()=>console.log('Jev local backend listening on 127.0.0.1'));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());}catch{console.error('Jev backend could not start; check ledger path, lock, and environment configuration');process.exitCode=1;}
}
