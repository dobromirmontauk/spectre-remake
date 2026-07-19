// Bundled (via esbuild, see scripts/run-engine-determinism.sh) into a single
// dependency-free script and run under three separate JS engines — V8
// (node), JavaScriptCore (jsc), SpiderMonkey (js140/spidermonkey) — to prove
// sim/ produces bit-identical hashState() given the exact same fixed
// command schedule, regardless of engine. This exercises the real sim/
// modules directly (not a reimplementation); sim/ never touches the DOM
// (see sim/CLAUDE.md), so running it outside a browser window is a faithful
// test of exactly the code path that matters for cross-browser lockstep.

import { createInitialState } from '../src/sim/simulation.ts';
import { step } from '../src/sim/simulation.ts';
import { hashState } from '../src/sim/hash.ts';
import type { Command } from '../src/sim/commands.ts';

const SEGMENTS: Command[] = [
  { turn: 1, thrust: 1, fire: false, grenade: false },
  { turn: -1, thrust: 1, fire: true, grenade: false },
  { turn: 0, thrust: 1, fire: true, grenade: false },
  { turn: -1, thrust: -1, fire: false, grenade: false },
  { turn: 1, thrust: 0, fire: true, grenade: false },
];

function runSchedule(): { tick: number; hash: number }[] {
  const state = createInitialState(1, [{ loadout: { speed: 9, shields: 100, ammo: 80 } }], 'solo');
  state.god = true; // keep the run alive the full 1200 ticks regardless of engine
  const segLen = 10;
  const totalTicks = 1200;
  const hashes: { tick: number; hash: number }[] = [];

  for (let tick = 0; tick < totalTicks; tick += segLen) {
    const seg = SEGMENTS[Math.floor(tick / segLen) % SEGMENTS.length]!;
    for (let i = 0; i < segLen; i++) {
      step(state, { player: seg });
    }
    const at = tick + segLen;
    if (at % 60 === 0) hashes.push({ tick: at, hash: hashState(state) });
  }
  return hashes;
}

// Cross-engine-portable output: jsc/js140 (shell engines) expose a global
// print(); node has no such global and uses console.log instead.
declare const print: ((s: string) => void) | undefined;
function emit(s: string): void {
  if (typeof print === 'function') print(s);
  else console.log(s);
}

const result = runSchedule();
emit(JSON.stringify(result));
