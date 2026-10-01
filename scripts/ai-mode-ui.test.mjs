import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});let calls=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/jev/**',route=>{if(new URL(route.request().url()).pathname==='/api/jev/decide')calls++;return route.fulfill({status:503,json:{error:'Offline UI verification fixture',spentUsd:0}});});
 await page.goto(process.env.JEV_UI_URL??'http://127.0.0.1:5184');await page.waitForFunction(()=>!!window.__game);await page.evaluate(()=>window.__game.setMuted(true));
 await page.locator('#ai-mode').check();
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.getByRole('button',{name:/^1 Player/}).click();await page.getByRole('button',{name:'Start',exact:true}).click();
 await page.waitForFunction(()=>window.__game.getState().aiMode===true && document.querySelector('#ai-mode').disabled);
 const active=await page.evaluate(()=>({state:window.__game.getState(),settings:window.__game.jev.getStats()}));assert.equal(active.state.players[0].lives,1);assert.ok(active.state.enemies.length<=3);assert.equal(active.settings.aiMode,true);assert.equal(active.settings.enabled,true);assert.equal(active.settings.hz,2);assert.equal(await page.locator('#ai-mode').isDisabled(),true,'mode locked during run');
 assert.match(await page.evaluate(()=>{try{window.__game.jev.configure({aiMode:false});return 'no rejection';}catch(e){return e.message;}}),/menu/);
 await page.evaluate(()=>window.__game.setLevel(5));assert.equal(await page.evaluate(()=>window.__game.getState().enemies.length),3);
 const stamp=await page.evaluate(()=>{const s=document.createElement('div');s.textContent='Offline UI fixture · finite AI mode · no paid calls';s.style='position:absolute;top:0;left:0;color:#ffd583;background:#182024;padding:4px;z-index:99;font:13px monospace';document.body.appendChild(s);return true;});assert.ok(stamp);
 mkdirSync('test/validation/ai-mode/mock-ui',{recursive:true});await page.screenshot({path:'test/validation/ai-mode/mock-ui/finite-ai-offline.png'});
 await page.evaluate(()=>{window.__game.pause();window.__game.killAllEnemies();window.__game.stepTicks(1);});assert.equal(await page.evaluate(()=>window.__game.getState().level),6,'squad defeat advances finite level');assert.equal(await page.evaluate(()=>window.__game.getState().players[0].lives),1);
 await page.evaluate(()=>{window.__game.gotoMenu();window.__game.startGame(undefined,{aiMode:false});});const normal=await page.evaluate(()=>window.__game.getState());assert.equal(normal.aiMode,false);assert.equal(normal.players[0].lives,3);assert.equal(await page.evaluate(()=>window.__game.jev.getStats().enabled),false);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({mockBackend:true,paidCalls:0,backendAttempts:calls,checks:['menu mode atomic start','1 finite player life','3 capped enemies','midmatch lock','squad clear level advance','ordinary mode reset isolation']}));
} finally {await browser.close();}
