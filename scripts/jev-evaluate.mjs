import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizeRun } from './jev-eval/report.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
  if (!match) throw new Error(`Expected --name=value: ${arg}`);
  return [match[1], match[2] ?? 'true'];
}));
const config = {
  url: args.url ?? 'http://localhost:5173/', duration: Number(args.duration ?? 30),
  enabled: args.enabled === 'true', offline: args.offline === 'true', autopilot: args.autopilot !== 'false',
  level: Number(args.level ?? 1), seed: Number(args.seed ?? 1991), hz: Number(args.hz ?? 5),
  seedApplied: false, seedNote: 'Requested seed recorded; game start uses built-in deterministic seed', maxEnemies: 3, god: false, video: args.video === 'true',
};
if (!Number.isFinite(config.duration) || config.duration <= 0 || config.duration > 300) throw new Error('Duration must be 0–300 seconds');
if (![2,5].includes(config.hz)) throw new Error('Hz must be 2 or 5');
if (!Number.isInteger(config.level) || config.level < 1 || !Number.isInteger(config.seed)) throw new Error('Invalid level/seed');
const target = new URL(config.url);
if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname)) throw new Error('Evaluation restricted to local server');
const output = resolve(args.output ?? `reference/verification/jev/run-${Date.now()}`);
await mkdir(output, {recursive:true});
const { chromium } = await import('playwright');
const browser = await chromium.launch({...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {}),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const context = await browser.newContext({viewport:{width:1280,height:800}, ...(config.video ? {recordVideo:{dir:output,size:{width:1280,height:800}}} : {})});
const page = await context.newPage();
const network = { requested:0, responses:0, httpFailures:0, transportFailures:0, statuses:{} };
const errors = [];
if (config.offline) {
  if (!config.enabled) throw new Error('Offline safe baseline requires --enabled=true');
  await page.route('**/api/jev**', route => route.abort('blockedbyclient'));
}
const isDecision = url => /\/api\/jev(?:[/?]|$)/.test(url);
page.on('request',r => { if (isDecision(r.url())) network.requested++; });
page.on('requestfailed',r => { if (isDecision(r.url())) network.transportFailures++; });
page.on('response',r => { if (isDecision(r.url())) {network.responses++;network.statuses[r.status()] = (network.statuses[r.status()] ?? 0)+1;if (!r.ok()) network.httpFailures++;} });
page.on('pageerror',e => errors.push(e.message));
let start = Date.now();
let stoppedReason = 'duration';
const samples = [];
try {
  await page.goto(config.url);
  await page.waitForFunction(() => Boolean(window.__game?.jev), null, {timeout:15000});
  await page.evaluate(config => {
    const g = window.__game;
    g.jev.configure({enabled:config.enabled,playerAutopilot:config.autopilot,hz:config.hz});
    g.startGame();
    g.setGod(false);
    g.setLevel(config.level);
  }, config);
  await page.screenshot({path:resolve(output,'start.png')});
  start = Date.now();
  while ((Date.now()-start)/1000 < config.duration) {
    const sample = await page.evaluate(() => ({state:window.__game.getState(),metrics:window.__game.jev.getStats(),observation:window.__game.jev.getObservation('player')}));
    sample.elapsedSeconds = (Date.now()-start)/1000;
    samples.push(sample);
    if ((sample.state.enemies?.length ?? 0) > 3 || (sample.state.players?.length ?? 0) > 1) {stoppedReason='tank-limit';break;}
    if (sample.state.god) {stoppedReason='unexpected-godmode';break;}
    if (sample.metrics.budgetExhausted || sample.metrics.spentUsd >= 10) {stoppedReason='budget';break;}
    if (sample.state.gameOver) {stoppedReason='game-over';break;}
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => {window.__game.jev.configure({enabled:false,playerAutopilot:false});window.__game.pause();});
  await page.screenshot({path:resolve(output,'end.png')});
} catch (error) {
  errors.push(error.stack ?? String(error)); stoppedReason='harness-error';
} finally {
  const elapsedSeconds = (Date.now()-start)/1000;
  await context.close();await browser.close();
  const report = summarizeRun({config,samples,network,errors,stoppedReason,elapsedSeconds});
  await writeFile(resolve(output,'report.json'), JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,stoppedReason,inferenceEvidence:report.inferenceEvidence,network,errors}));
  if (stoppedReason === 'harness-error' || stoppedReason === 'tank-limit' || stoppedReason === 'unexpected-godmode' || (config.enabled && !config.offline && report.inferenceEvidence === 'no-model-decisions-observed')) process.exitCode=1;
}
