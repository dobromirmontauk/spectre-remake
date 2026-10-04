// Run a repository HTTP server first. npm install --no-save playwright; ffmpeg on PATH.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const output=fileURLToPath(new URL('squad-replay.mp4',import.meta.url));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
await page.goto(process.env.REPLAY_URL??'http://127.0.0.1:5183/test/validation/ai-mode/2026-10-01/replay.html');
await page.waitForFunction(()=>window.__replay?.ready);
await page.evaluate(()=>{for(const e of document.querySelector('footer').children)e.style.display='none';document.querySelector('footer').insertAdjacentHTML('beforeend','<b id="caption"></b>');document.querySelector('footer').style.fontSize='19px';});
const phases=[[0,'Actual game 05 · three finite-life enemies · scripted flag-rushing player'],[4,'Search missions divide the arena; the panels show actual mission and tactical action.'],[10,'Contact reports guide squad assignments. The model does not receive hidden player positions.'],[20,'Watch separate firing angles: player hits and missed projectiles are recorded independently.'],[30,'Remaining flags inform mission urgency; death is permanent within this level.']];
const duration=await page.evaluate(()=>window.__replay.duration);
const fps=24;const encoder=spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-vcodec','png','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:['pipe','inherit','inherit']});
for(let i=0;i<Math.ceil(duration*fps);i++){
 const t=i/fps,caption=phases.findLast(p=>p[0]<=t)[1];
 await page.evaluate(({t,caption})=>{window.__replay.setTime(t);document.querySelector('#caption').textContent=caption;},{t,caption});
 const png=await page.screenshot({type:'png'});if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
 if(i%240===0)console.log(`Rendered ${t.toFixed(0)}/${duration.toFixed(1)} seconds`);
}
encoder.stdin.end();const [code]=await once(encoder,'close');await page.evaluate(()=>{window.__replay.setTime(24);document.querySelector('#caption').textContent='Actual tick replay · full scene for evaluation only · actual mission and tactical action in panels.';});await page.screenshot({path:fileURLToPath(new URL('preview.png',import.meta.url))});await browser.close();if(code!==0)throw Error(`ffmpeg failed ${code}`);console.log(output);
