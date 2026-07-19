// Deterministic state checksum — the desync-detection primitive for future
// lockstep multiplayer (M3+): every peer hashes its own state after the same
// confirmed tick and compares; any mismatch means two peers' sims have
// diverged (an engine-specific float rounding difference, a dropped/
// reordered command, etc.) and the match should end gracefully rather than
// let players watch two different games.
//
// FNV-1a-32 over a canonical walk of quantized state, built only from
// Math.imul/bitwise ops and Math.round — all IEEE-754-exact per spec, so the
// hash itself is bit-identical across engines given identical (quantized)
// input, exactly like sim/dmath.ts's determinism argument. Continuous
// values (position/heading/speed) are quantized via Math.round(value*scale)
// before hashing so that sub-ULP differences that don't affect gameplay
// (e.g. from the ~1e-9 error dmath.ts allows vs native Math) don't also
// trip a false-positive desync — only differences big enough to matter at
// the sim's own precision (1/256 world unit, 1/1024 radian) register.

import type { GameState, TankState } from './types.ts';

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// Mixes one 32-bit integer into the hash a byte at a time — the standard
// FNV-1a byte-wise algorithm, applied to `value`'s 4 bytes.
function mixInt(hash: number, value: number): number {
  let h = hash;
  const v = Math.round(value) | 0;
  for (let shift = 0; shift < 32; shift += 8) {
    const byte = (v >>> shift) & 0xff;
    h ^= byte;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function mixBool(hash: number, value: boolean): number {
  return mixInt(hash, value ? 1 : 0);
}

function mixString(hash: number, value: string): number {
  let h = hash;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

// Quantizes a continuous value to a fixed-point integer before hashing —
// `scale` is world-units^-1 for position (256 => 1/256 unit resolution) or
// radians^-1 for heading (1024 => ~0.001 rad resolution).
function q(value: number, scale: number): number {
  return Math.round(value * scale);
}

function mixTank(hash: number, tank: TankState): number {
  let h = hash;
  h = mixInt(h, q(tank.position.x, 256));
  h = mixInt(h, q(tank.position.z, 256));
  h = mixInt(h, q(tank.heading, 1024));
  h = mixInt(h, q(tank.speed, 256));
  h = mixInt(h, tank.shield);
  h = mixInt(h, tank.ammo);
  h = mixBool(h, tank.alive);
  h = mixInt(h, tank.fireCooldown);
  h = mixInt(h, tank.grenadeCooldown);
  h = mixInt(h, tank.invulnerableTicks);
  h = mixInt(h, tank.respawnTicksRemaining);
  return h;
}

// Pure function of `state` — no wall-clock, no Set/Map iteration-order
// hazards (every walk below is a plain array in a fixed, meaningful order:
// slot order for players, array order for enemies/projectiles/grenades).
export function hashState(state: GameState): number {
  let h = FNV_OFFSET_BASIS;

  h = mixInt(h, state.tick);
  h = mixInt(h, state.rng.state);
  h = mixString(h, state.mode);
  h = mixInt(h, state.level);
  h = mixInt(h, state.flagsCollected);
  h = mixInt(h, state.score);
  h = mixString(h, state.winner ?? '');
  h = mixBool(h, state.gameOver);

  for (const player of state.players) {
    h = mixTank(h, player);
    h = mixInt(h, player.lives);
    h = mixInt(h, player.kills);
  }

  for (const enemy of state.enemies) {
    h = mixTank(h, enemy);
  }

  for (const shot of state.projectiles) {
    h = mixInt(h, q(shot.position.x, 256));
    h = mixInt(h, q(shot.position.z, 256));
    h = mixInt(h, q(shot.heading, 1024));
    h = mixInt(h, q(shot.speed, 256));
    h = mixInt(h, shot.ticksRemaining);
  }

  for (const grenade of state.grenades) {
    h = mixInt(h, q(grenade.position.x, 256));
    h = mixInt(h, q(grenade.position.z, 256));
    h = mixInt(h, q(grenade.heading, 1024));
    h = mixInt(h, q(grenade.speed, 256));
    h = mixInt(h, grenade.fuseTicksRemaining);
  }

  return h >>> 0;
}
