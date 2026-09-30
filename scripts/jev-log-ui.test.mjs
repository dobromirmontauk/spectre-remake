import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});let decide=0,history=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/jev/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/jev/decide'){decide++;const input=req.postDataJSON();await route.fulfill({json:{sequence:input.sequence,tick:input.tick,decisions:input.tanks.map((t,i)=>({tankId:t.tankId,choice:t.candidates[0].id,confidence:.8,callId:`00000000-0000-4000-8000-${String(decide*10+i).padStart(12,'0')}`})),usage:{inputTokens:0},spentUsd:0}});}
  else if(url.pathname==='/api/jev/history'){history++;assert.ok(url.searchParams.get('callId'));await route.fulfill({json:{records:[{type:'request',callId:url.searchParams.get('callId'),payload:{model:'mock-ui-fixture',instructions:'Mock API fixture, no model call.'}}],nextOffset:1,total:1}});}
  else await route.fulfill({json:{ok:true}});
 });
 await page.goto(process.env.JEV_UI_URL??'http://127.0.0.1:5184');await page.waitForFunction(()=>!!window.__game);
 await page.evaluate(()=>{window.__game.setMuted(true);window.__game.jev.showDecisionLog(true);});
 assert.match(await page.locator('.jev-log-body').innerText(),/No Jev requests yet/);
 await page.evaluate(()=>{window.__game.jev.configure({enabled:true,playerAutopilot:true});window.__game.startGame();window.__game.setLevel(5);});
 await page.waitForFunction(()=>window.__game.jev.getDecisionLog().some(r=>r.decisions.some(d=>d.applied)));
 assert.equal(await page.locator('.jev-log details[open]').count(),0,'exact inputs collapsed by default');assert.equal(history,0,'provider history only loaded after expansion');
 assert.ok(!(await page.locator('.jev-log-body').innerText()).includes('No Jev requests yet'),'empty placeholder cleared');
 await page.evaluate(()=>{const stamp=document.createElement('div');stamp.textContent='Mock API fixture · UI verification only · no paid calls';stamp.style='position:absolute;top:0;left:0;color:#ffd583;background:#182024;padding:4px;z-index:99;font:13px monospace';document.body.appendChild(stamp);});
 mkdirSync('reference/verification/jev-v2',{recursive:true});await page.screenshot({path:'reference/verification/jev-v2/decision-log-collapsed-mock.png'});
 const id=await page.locator('.jev-log-row').first().getAttribute('data-audit-id');const row=page.locator(`.jev-log-row[data-audit-id="${id}"]`);await row.locator('details>summary').click();
 await page.waitForFunction(()=>document.querySelector('.jev-log pre:last-child')?.textContent?.includes('mock-ui-fixture'));
 await page.waitForTimeout(800);assert.equal(await row.locator('details[open]').count(),1,'expanded row remains open across new batches');assert.ok(history>0);
 await page.screenshot({path:'reference/verification/jev-v2/decision-log-expanded-mock.png'});
 const exported=await page.evaluate(()=>window.__game.jev.exportDecisionLog());assert.ok(exported.length>=2);assert.ok(exported.some(r=>r.decisions.some(d=>d.applied)));
 await page.evaluate(()=>window.__game.jev.configure({enabled:false}));await page.reload();await page.waitForFunction(()=>!!window.__game);const afterRefresh=await page.evaluate(()=>window.__game.jev.exportDecisionLog());assert.ok(afterRefresh.length>=exported.length,'exact attempts persisted across browser refresh');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({mock:true,paidCalls:0,decide,history,browserRecords:afterRefresh.length,checks:['collapsed default','empty state transition','lazy per-call exact history','stable expansion','persisted full browser export']}));
} finally {await browser.close();}
