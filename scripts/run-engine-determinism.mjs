// The core M1 deliverable: proves sim/ produces bit-identical hashState()
// results regardless of JS engine, by bundling scripts/engine-determinism-entry.ts
// (which drives createInitialState/step/hashState directly — no DOM, no
// browser, matching sim/'s own purity contract) into one dependency-free
// script via esbuild, then running that EXACT SAME script under three
// separate, independent JS engines:
//   - V8            (node — the engine inside Chromium)
//   - JavaScriptCore (jsc — the engine inside Safari/WebKit; ships with macOS)
//   - SpiderMonkey   (js140 — the engine inside Firefox; `brew install spidermonkey`)
//
// This sandbox's network could not reliably fetch Playwright's Firefox/
// WebKit browser binaries (repeated installs stalled with zero throughput
// after the initial lockfile stage), so this runs the actual three engines
// directly instead of through a browser window — a faithful substitute
// since sim/ never touches the DOM (see sim/CLAUDE.md). Chromium itself
// *was* installable, and scripts/verify-m1.mjs separately cross-checks that
// a live Chromium page's __game.hashState() matches this script's V8 output
// for the same schedule, confirming app.ts/debug.ts add no discrepancy.
//
// Run with: node scripts/run-engine-determinism.mjs

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(root, 'scripts', 'engine-determinism-entry.ts');

const JSC_PATH = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc';
const SPIDERMONKEY_GLOB = '/opt/homebrew/Cellar/spidermonkey/*/bin/js140';

function findSpidermonkey() {
  try {
    const out = execSync(`ls ${SPIDERMONKEY_GLOB}`, { encoding: 'utf8' }).trim().split('\n');
    return out[0];
  } catch {
    return null;
  }
}

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'spectre-engine-determinism-'));
const bundlePath = path.join(tmpDir, 'bundle.js');

try {
  execSync(`npx esbuild "${entry}" --bundle --format=iife --target=es2020 --outfile="${bundlePath}"`, {
    cwd: root,
    stdio: 'inherit',
  });

  const engines = [
    { name: 'V8 (node)', cmd: `node "${bundlePath}"` },
    { name: 'JavaScriptCore (jsc)', cmd: `"${JSC_PATH}" "${bundlePath}"`, requires: JSC_PATH },
    { name: 'SpiderMonkey (js140)', cmd: null }, // resolved below
  ];

  const spidermonkey = findSpidermonkey();
  if (spidermonkey) engines[2].cmd = `"${spidermonkey}" -f "${bundlePath}"`;

  const results = {};
  for (const engine of engines) {
    if (engine.requires && !existsSync(engine.requires)) {
      console.log(`SKIP ${engine.name}: not found at ${engine.requires}`);
      continue;
    }
    if (!engine.cmd) {
      console.log(`SKIP ${engine.name}: binary not found (expected under ${SPIDERMONKEY_GLOB})`);
      continue;
    }
    const output = execSync(engine.cmd, { encoding: 'utf8' }).trim();
    results[engine.name] = JSON.parse(output);
    console.log(`${engine.name}: ran schedule, ${results[engine.name].length} checkpoints collected.`);
  }

  const names = Object.keys(results);
  if (names.length < 2) {
    console.error('Fewer than 2 engines produced results — cannot cross-compare.');
    process.exit(1);
  }

  const reference = results[names[0]];
  let allMatch = true;
  console.log('');
  for (let i = 0; i < reference.length; i++) {
    const tick = reference[i].tick;
    const values = names.map((n) => results[n][i].hash);
    const unique = new Set(values);
    const match = unique.size === 1;
    if (!match) allMatch = false;
    console.log(`tick ${tick}: ${names.map((n, idx) => `${n}=${values[idx]}`).join(', ')} :: ${match ? 'MATCH' : 'MISMATCH'}`);
  }

  console.log(`\nCross-engine determinism proof: ${allMatch ? `ALL ${reference.length} checkpoints MATCH across ${names.join(', ')}` : 'MISMATCH DETECTED'}`);
  if (!allMatch) process.exit(1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
