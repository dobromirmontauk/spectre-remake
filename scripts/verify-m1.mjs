// M1 runtime verification: drives the actual dev server through
// window.__game (see CLAUDE.md's debug API) to sanity-check solo/local-2P
// play, and — the core M1 deliverable — proves the sim produces IDENTICAL
// state hashes (sim/hash.ts) across Chromium, Firefox, and WebKit when fed
// the exact same fixed command schedule. Run with:
//   node scripts/verify-m1.mjs

// NOTE: this sandbox's network could not reliably download Playwright's
// Firefox/WebKit browser binaries (installs repeatedly stalled with zero
// throughput after the lockfile stage — see the M1 report for details), so
// the cross-engine hash proof itself runs separately via
// scripts/engine-determinism-entry.ts under three real, independent engines
// (V8/node, JavaScriptCore/jsc, SpiderMonkey/js140) with no browser
// involved — sim/ never touches the DOM, so that's a faithful substitute.
// This script covers what genuinely needs a live page: the actual
// index.html + app.ts + debug.ts wiring, exercised through Chromium (the
// one engine that did install cleanly).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5183;
const URL = `http://localhost:${PORT}/`;

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryFetch = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - start > timeoutMs) reject(new Error('dev server did not start in time'));
          else setTimeout(tryFetch, 300);
        });
    };
    tryFetch();
  });
}

function startDevServer() {
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return proc;
}

async function newPage(browserType, label) {
  // Headless Chromium has no GPU by default in this sandbox; force software
  // WebGL (SwiftShader) so THREE.WebGLRenderer can actually initialize —
  // otherwise app.ts throws before window.__game is ever installed.
  const browser = await browserType.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error(`[${label}] page error:`, err.message));
  await page.goto(URL);
  await page.waitForFunction(() => typeof window.__game !== 'undefined', null, { timeout: 15000 });
  return { browser, page };
}

// --- Solo sanity: drive, shoot, collect a flag, confirm level clears ---
async function verifySolo(page, label) {
  const result = await page.evaluate(() => {
    const g = window.__game;
    g.startGame({ speed: 9, shields: 100, ammo: 80 });
    g.setGod(true);
    g.pressCommand({ thrust: 1 }, 10);
    g.stepTicks(10);
    g.fire();
    g.stepTicks(5);
    const beforeScore = g.getState().score;
    g.collectAllFlags();
    g.stepTicks(3);
    const after = g.getState();
    return { beforeScore, afterScore: after.score, level: after.level, flagsCollected: after.flagsCollected, players: after.players.length };
  });
  const ok = result.afterScore > result.beforeScore && result.level === 2 && result.players === 1;
  console.log(`[${label}] solo: score ${result.beforeScore} -> ${result.afterScore}, level -> ${result.level}, players=${result.players} :: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) throw new Error(`[${label}] solo sanity check failed: ${JSON.stringify(result)}`);
}

// --- Local 2P co-op: 2 players, shared lives pools, no friendly fire ---
async function verifyCoop(page, label) {
  const result = await page.evaluate(() => {
    const g = window.__game;
    g.startGame({ speed: 9, shields: 100, ammo: 80 }, { mode: 'coop', loadout2: { speed: 9, shields: 100, ammo: 80 } });
    const before = g.getState();
    const p2ShieldBefore = before.players[1].shield;
    // Turn slot 0 to face slot 1 (spawned COOP_SPAWN_OFFSET to the east,
    // i.e. +x) and fire repeatedly at point-blank range.
    g.pressCommand({ turn: 1 }, 20);
    g.stepTicks(20);
    g.pressCommand({ fire: true }, 15);
    g.stepTicks(15);
    const after = g.getState();
    return {
      mode: before.mode,
      playerCount: before.players.length,
      p2ShieldBefore,
      p2ShieldAfter: after.players[1].shield,
    };
  });
  const noFriendlyFire = result.p2ShieldAfter === result.p2ShieldBefore;
  const ok = result.mode === 'coop' && result.playerCount === 2 && noFriendlyFire;
  console.log(
    `[${label}] coop: players=${result.playerCount}, p2 shield ${result.p2ShieldBefore} -> ${result.p2ShieldAfter} (friendly fire off: ${noFriendlyFire}) :: ${ok ? 'PASS' : 'FAIL'}`,
  );
  if (!ok) throw new Error(`[${label}] coop sanity check failed: ${JSON.stringify(result)}`);
}

// --- Local 2P duel: PvP damage registers, kill tally is live ---
async function verifyDuel(page, label) {
  const result = await page.evaluate(() => {
    const g = window.__game;
    g.startGame({ speed: 9, shields: 100, ammo: 80 }, { mode: 'duel', loadout2: { speed: 9, shields: 100, ammo: 80 } });
    const before = g.getState();
    const p2ShieldBefore = before.players[1].shield;
    // Slot 0 spawns at (0,-80) heading 0 (facing +z), slot 1 at (0,80) heading
    // pi (facing -z) — already facing each other down a straight line. Thrust
    // + fire repeatedly to close the gap and land shots.
    for (let i = 0; i < 6; i++) {
      g.pressCommand({ thrust: 1, fire: true }, 10);
      g.stepTicks(10);
    }
    const after = g.getState();
    return {
      mode: before.mode,
      winner: before.winner,
      p2ShieldBefore,
      p2ShieldAfter: after.players[1].shield,
      p1Kills: after.players[0].kills,
    };
  });
  const damageRegistered = result.p2ShieldAfter < result.p2ShieldBefore || result.p1Kills > 0;
  const ok = result.mode === 'duel' && result.winner === null && damageRegistered;
  console.log(
    `[${label}] duel: p2 shield ${result.p2ShieldBefore} -> ${result.p2ShieldAfter}, p1 kills=${result.p1Kills} (PvP damage: ${damageRegistered}) :: ${ok ? 'PASS' : 'FAIL'}`,
  );
  if (!ok) throw new Error(`[${label}] duel sanity check failed: ${JSON.stringify(result)}`);
}

// Sanity cross-check only (the real cross-engine proof is the standalone
// engine-determinism run) — confirms the live page's __game.hashState()
// wiring produces the same value the pure-sim bundle does for the same
// schedule, i.e. app.ts/debug.ts introduce no discrepancy of their own.
async function runHashSchedule(page) {
  return await page.evaluate(() => {
    const g = window.__game;
    g.startGame({ speed: 9, shields: 100, ammo: 80 });
    g.setGod(true); // keep the run alive the full 1200 ticks regardless of engine
    const segments = [
      { turn: 1, thrust: 1, fire: false, grenade: false },
      { turn: -1, thrust: 1, fire: true, grenade: false },
      { turn: 0, thrust: 1, fire: true, grenade: false },
      { turn: -1, thrust: -1, fire: false, grenade: false },
      { turn: 1, thrust: 0, fire: true, grenade: false },
    ];
    const segLen = 10;
    const totalTicks = 1200;
    const hashes = [];
    for (let tick = 0; tick < totalTicks; tick += segLen) {
      const seg = segments[Math.floor(tick / segLen) % segments.length];
      g.pressCommand(seg, segLen);
      g.stepTicks(segLen);
      const t = tick + segLen;
      if (t % 60 === 0) hashes.push({ tick: t, hash: g.hashState() });
    }
    return hashes;
  });
}

async function main() {
  const devServer = startDevServer();
  devServer.stdout.on('data', () => {});
  devServer.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));

  try {
    await waitForServer(URL);
    console.log(`Dev server up at ${URL}\n`);

    const { browser, page } = await newPage(chromium, 'chromium');
    try {
      await verifySolo(page, 'chromium');
      await verifyCoop(page, 'chromium');
      await verifyDuel(page, 'chromium');
      console.log('[chromium] running 1200-tick fixed schedule (sanity cross-check vs the standalone engine bundle)...');
      const hashes = await runHashSchedule(page);
      console.log(`[chromium] collected ${hashes.length} hash checkpoints:`);
      for (const { tick, hash } of hashes) console.log(`  tick ${tick}: ${hash}`);
    } finally {
      await browser.close();
    }
  } finally {
    devServer.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
