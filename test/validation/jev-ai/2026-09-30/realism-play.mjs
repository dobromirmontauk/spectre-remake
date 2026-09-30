import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const level=Number(process.argv[2]??5),duration=Number(process.argv[3]??90),out=new URL('./level'+level+'/',import.meta.url).pathname;
if(duration>120||![2,3,5].includes(level))throw Error('bounded run only');await mkdir(out,{recursive:true});
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}});
const page=await context.newPage();await page.route('**/src/game/jev-session.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\n globalThis.__jevSessionConstructor = JevSession;\n'});});const errors=[],samples=[];page.on('pageerror',e=>errors.push(e.message));
if(process.env.MOCK_JEV==='1')await page.route('**/api/jev/**',async route=>{if(route.request().url().endsWith('/decide')){const b=route.request().postDataJSON();await route.fulfill({json:{sequence:b.sequence,tick:b.tick,decisions:b.tanks.map(t=>({tankId:t.tankId,choice:t.candidates[0].id,confidence:.8})),usage:{inputTokens:0},spentUsd:0}});}else await route.fulfill({json:{records:[],total:0,nextOffset:null,recordId:'mock'}});});
let actions=[],decisions=[],metrics,auditVerification=null;
try{
 await page.goto('http://127.0.0.1:5183/');await page.waitForFunction(()=>window.__game?.jev.showDecisionLog);
 await page.evaluate(async level=>{
  window.__jevActions=[];
  const {angleDelta,blocked,distance}=await import('/src/jev/observation.ts');const {datan2}=await import('/src/sim/dmath.ts');const JevSession=window.__jevSessionConstructor;const original=JevSession.prototype.command;
  JevSession.prototype.command=function(state,tank){const command=original.call(this,state,tank);const p=this.plans[tank.id],o=this.observations[tank.id];const foeTanks=state.players.some(t=>t.id===tank.id)?state.enemies:state.players;const visibleNow=foeTanks.filter(t=>t.alive&&distance(tank.position,t.position)<=65&&Math.abs(angleDelta(datan2(t.position.x-tank.position.x,t.position.z-tank.position.z),tank.heading))<=Math.PI*.65&&!blocked(tank.position,t.position,state.obstacles));window.__jevActions.push({tick:state.tick,level:state.level,id:tank.id,role:state.players.some(t=>t.id===tank.id)?'player':'enemy',position:{...tank.position},heading:tank.heading,speed:tank.speed,fireCooldown:tank.fireCooldown,visibleOpponentsNow:visibleNow.map(t=>({id:t.id,range:distance(tank.position,t.position),bearingError:angleDelta(datan2(t.position.x-tank.position.x,t.position.z-tank.position.z),tank.heading)})),shield:tank.shield,shieldFraction:tank.shield/tank.maxShield,command:{...command},planId:p?.id??null,strategy:p?.strategy??null,sequence:this.selectionSerial[tank.id]??null,expired:!p||p.expiresTick<state.tick,modelAgeTicks:this.modelTicks[tank.id]===undefined?null:state.tick-this.modelTicks[tank.id],opponents:o?.contacts.filter(c=>c.kind==='tank'&&c.team!==o.own.team).map(c=>({id:c.id,position:c.position,heading:c.heading,seenTick:c.seenTick,ageSeconds:c.ageSeconds,source:c.source}))??[],recentThreat:o?.recentThreat??null});return command;};
  const g=window.__game;g.jev.configure({enabled:true,playerAutopilot:true,hz:2});g.startGame();g.setGod(false);g.setLevel(level);g.jev.showDecisionLog(false);g.cycleCamera();g.cycleCamera();g.cycleCamera();
 },level);
 const start=Date.now();let nextShot=0;
 while(Date.now()-start<duration*1000){
  const sample=await page.evaluate(()=>({state:window.__game.getState(),metrics:window.__game.jev.getStats()}));sample.elapsedSeconds=(Date.now()-start)/1000;samples.push(sample);
  if(sample.state.enemies.length>3||sample.state.players.length>1||sample.metrics.budgetExhausted||sample.state.gameOver)break;
  if(sample.elapsedSeconds>=nextShot){await page.screenshot({path:out+`frame-${String(Math.floor(nextShot)).padStart(3,'0')}.png`});nextShot+=10;}
  await page.waitForTimeout(200);
 }
 await page.evaluate(()=>{window.__game.pause();window.__game.jev.configure({enabled:false,playerAutopilot:false});});
 ({actions,decisions,metrics}=await page.evaluate(async()=>({actions:window.__jevActions,decisions:await window.__game.jev.exportDecisionLog(),metrics:window.__game.jev.getStats()})));
 await page.screenshot({path:out+'end.png'});
 if(process.env.MOCK_JEV!=='1'){
  auditVerification=await page.evaluate(async()=>{const g=window.__game;g.jev.showDecisionLog(true);const batch=g.jev.getDecisionLog().slice().reverse().find(r=>r.decisions.some(d=>d.callId));if(!batch)throw Error('No linked real provider calls');const records=[];for(const d of batch.decisions){if(!d.callId)continue;const history=await fetch('/api/jev/history?callId='+d.callId+'&limit=10').then(r=>r.json());const request=history.records.find(r=>r.type==='request');const expected=structuredClone(batch.request.tanks.find(t=>t.tankId===d.tankId).observation);const normalize=h=>((h%(2*Math.PI))+(2*Math.PI))%(2*Math.PI);if(Number.isFinite(expected.own.heading))expected.own.heading=normalize(expected.own.heading);for(const c of [...expected.contacts,...expected.memory])if(c.kind==="tank"&&Number.isFinite(c.heading))c.heading=normalize(c.heading);if(JSON.stringify(request.payload.state.observations[d.tankId])!==JSON.stringify(expected))throw Error('Exact model perspective does not match browser captured input');records.push(...history.records);}const row=document.querySelector('[data-audit-id="'+batch.id+'"] details');if(row)row.open=true;return {batchId:batch.id,allPerspectivesMatch:true,records};});
  await page.waitForTimeout(500);await page.screenshot({path:out+'real-log-expanded.png'});
 }

}finally{await context.close();await browser.close();}
if(!actions.length)throw Error('Action instrumentation failed: zero executed commands recorded');
await writeFile(out+'actions.json.gz',gzipSync(JSON.stringify(actions)));await writeFile(out+'samples.json.gz',gzipSync(JSON.stringify(samples)));await writeFile(out+'decisions.json.gz',gzipSync(JSON.stringify(decisions)));
const realism={};
for(const id of [...new Set(actions.filter(a=>a.role==='enemy').map(a=>a.id))]){
 const rows=actions.filter(a=>a.id===id);let still=0,maxStill=0,reversals=0,previousTurn=0,lastTurnTick=-1000,quickFlips=0,underFire=0,survival=0,visible=0,fire=0,pursue=0,damageEvents=0,lastShield=null;
 for(const r of rows){still=Math.abs(r.speed)<.5?still+1:0;maxStill=Math.max(maxStill,still);if(r.command.turn&&previousTurn&&r.command.turn!==previousTurn){reversals++;if(r.tick-lastTurnTick<=15)quickFlips++;}if(r.command.turn){if(r.command.turn!==previousTurn)lastTurnTick=r.tick;previousTurn=r.command.turn;}
  if(lastShield!==null&&r.shield<lastShield)damageEvents++;lastShield=r.shield;
  if(r.recentThreat||r.shieldFraction<.35){underFire++;if(['retreat','regroup'].includes(r.strategy))survival++;}
  if(r.opponents.length){visible++;if(r.command.fire)fire++;if(r.strategy==='pursue')pursue++;}
 }
 let jiggleWindows=0;
 for(let i=0;i+60<rows.length;i+=30){const block=rows.slice(i,i+60);if(block.at(-1).tick-block[0].tick!==59)continue;let flips=0,last=0,rotation=0;for(let j=0;j<block.length;j++){const turn=block[j].command.turn;if(last&&turn&&last!==turn)flips++;if(turn)last=turn;if(j)rotation+=Math.abs(block[j].heading-block[j-1].heading);}const displacement=Math.hypot(block.at(-1).position.x-block[0].position.x,block.at(-1).position.z-block[0].position.z);if(flips>=4&&rotation>.5&&Math.abs(block.at(-1).heading-block[0].heading)<.15&&displacement<1&&!block.some(r=>r.command.fire))jiggleWindows++;}
 const ownVisibleRows=rows.filter(r=>r.visibleOpponentsNow?.length);
 realism[id]={nonFiringStationaryJiggleWindows:jiggleWindows,ownVisibleNowTicks:ownVisibleRows.length,ownVisibleFireTicks:ownVisibleRows.filter(r=>r.command.fire).length,seconds:rows.length/30,maxStationarySeconds:maxStill/30,turnReversals:reversals,quickTurnFlips:quickFlips,underFireTicks:underFire,survivalStrategyTicks:survival,visibleOpponentTicks:visible,fireCommandTicks:fire,pursuitTicks:pursue,damageEvents};
}
const summary={mocked:process.env.MOCK_JEV==='1',level,duration,actions:actions.length,metrics,realism,auditVerification,errors,notes:['Model choices and exact per-tick executor commands recorded separately.','Stationary uses abs(speed)<0.5; turn reversals are diagnostics requiring visual review, not automatically defects.','Opponents are last request observations; exact own visibility at execution may differ; safe fire requires current cannon alignment.']};
await writeFile(out+'summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({out,realism,metrics:{acceptedHzPerTank:metrics.acceptedHzPerTank,modelDecisions:metrics.modelDecisions,spentUsd:metrics.spentUsd,contacts:metrics.obstacleContacts+metrics.tankContacts,friendlyFire:metrics.friendlyFireDamage},errors}));
