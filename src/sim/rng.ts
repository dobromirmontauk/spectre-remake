// Seeded PRNG (mulberry32) — the only source of randomness in the sim.
// state.rng.next() must be used everywhere instead of Math.random().

import type { RngState } from './types.ts';

export function createRng(seed: number): RngState {
  let s = seed >>> 0;
  return {
    get state(): number {
      return s;
    },
    set state(v: number) {
      s = v >>> 0;
    },
    next(): number {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
