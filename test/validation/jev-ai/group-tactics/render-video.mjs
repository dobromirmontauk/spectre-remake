// Run a repository HTTP server first. npm install --no-save playwright; ffmpeg on PATH.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const output=fileURLToPath(new URL('group-tactics.mp4',import.meta.url));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
await page.goto(process.env.REPLAY_URL??'http://127.0.0.1:5185/test/validation/jev-ai/group-tactics/replay.html');
await page.waitForFunction(()=>window.__replay?.ready);
await page.evaluate(()=>{for(const e of document.querySelector('footer').children)e.style.display='none';document.querySelector('footer').insertAdjacentHTML('beforeend','<b id="caption"></b>');document.querySelector('footer').style.fontSize='19px';});
const phases=[[0,'Four AI commanders. Patrol becomes contact and combat.'],[5,'Multiple defenders engage the player. Watch their headings and firing decisions.'],[10,'Enemy 3 selects retreat while the other defenders continue the fight.'],[17,'Enemy 1 selects regroup toward Enemy 2, whose last strategy was retreat.'],[24,'Own sightings and shared reports are shown separately in the commander panels.'],[30,'The group reacquires contact; regroup and engagement decisions alternate.'],[35,'Several defenders engage while the player tries to survive and collect flags.'],[40,'Retreat remains available during combat: the defenders value survival.']];
const fps=24;const encoder=spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-vcodec','png','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:['pipe','inherit','inherit']});
for(let i=0;i<48*fps;i++){
 const t=i/fps,caption=phases.findLast(p=>p[0]<=t)[1];
 await page.evaluate(({t,caption})=>{window.__replay.setTime(t);document.querySelector('#caption').textContent=caption;},{t,caption});
 const png=await page.screenshot({type:'png'});if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
 if(i%240===0)console.log(`Rendered ${t.toFixed(0)}/48 seconds`);
}
encoder.stdin.end();const [code]=await once(encoder,'close');await page.evaluate(()=>{window.__replay.setTime(18);document.querySelector('#caption').textContent='Enemy 1 regroups toward a retreating ally; Enemy 3 uses a shared player report.';});await page.screenshot({path:fileURLToPath(new URL('preview.png',import.meta.url))});await browser.close();if(code!==0)throw Error(`ffmpeg failed ${code}`);console.log(output);
