// WebAudio-synthesized SFX — no asset files. Consumes the same per-frame
// SimEvent batch the HUD/effects layers use, plus the player's speed (for
// the engine loop) and pause/menu state have no bearing here: audio keeps
// running under the hood even in menus so a click can resume playback
// immediately, but the engine loop is driven only from gameplay updates.

import type { SimEvent } from '../sim/events.ts';

const MUTE_STORAGE_KEY = 'spectre.muted.v1';

let ctx: AudioContext | null = null;
let muted = loadMuted();
let masterGain: GainNode | null = null;

let engineOsc: OscillatorNode | null = null;
let engineGain: GainNode | null = null;

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(v: boolean): void {
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, v ? '1' : '0');
  } catch {
    // ignore — storage unavailable, mute state just won't persist
  }
}

// Must be called from a user gesture (menu click / keypress) — browsers
// block AudioContext creation/resume before one. Safe to call repeatedly.
export function resumeAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : 1;
    masterGain.connect(ctx.destination);
    buildEngineLoop();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  saveMuted(v);
  if (masterGain && ctx) masterGain.gain.setTargetAtTime(v ? 0 : 1, ctx.currentTime, 0.02);
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

function now(): number {
  return ctx ? ctx.currentTime : 0;
}

function envGain(peak: number, attack: number, release: number): GainNode {
  const g = ctx!.createGain();
  const t = now();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  g.connect(masterGain!);
  return g;
}

// Short burst of white noise through a gain envelope — used for the "tick"
// texture layered under cannon fire and inside explosions/blasts.
function noiseBurst(duration: number, peak: number, filterFreq?: number): void {
  if (!ctx) return;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const g = envGain(peak, 0.002, duration);
  let node: AudioNode = src;
  if (filterFreq !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    src.connect(filter);
    node = filter;
  }
  node.connect(g);
  src.start();
  src.stop(now() + duration + 0.02);
}

function tone(
  freqStart: number,
  freqEnd: number,
  duration: number,
  peak: number,
  type: OscillatorType = 'square',
): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  const t = now();
  osc.frequency.setValueAtTime(freqStart, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + duration);
  const g = envGain(peak, 0.005, duration);
  osc.connect(g);
  osc.start();
  osc.stop(t + duration + 0.02);
}

// Two-note arpeggio (rising) — flag pickup.
function arpeggioUp(base: number, semitoneStep: number, noteDuration: number, peak: number): void {
  if (!ctx) return;
  const ratio = Math.pow(2, semitoneStep / 12);
  tone(base, base, noteDuration, peak, 'triangle');
  window.setTimeout(() => tone(base * ratio, base * ratio, noteDuration, peak, 'triangle'), noteDuration * 1000 * 0.85);
}

// Short 3-note fanfare — level complete.
function fanfare(): void {
  if (!ctx) return;
  const notes = [440, 554.37, 659.25];
  notes.forEach((f, i) => {
    window.setTimeout(() => tone(f, f, 0.14, 0.22, 'triangle'), i * 90);
  });
}

function buildEngineLoop(): void {
  if (!ctx || !masterGain) return;
  engineOsc = ctx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 40;
  engineGain = ctx.createGain();
  engineGain.gain.value = 0; // silent until updateEngine() sees nonzero speed
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  engineOsc.connect(filter);
  filter.connect(engineGain);
  engineGain.connect(masterGain);
  engineOsc.start();
}

const ENGINE_BASE_FREQ = 35;
const ENGINE_FREQ_PER_SPEED = 6;
const ENGINE_MAX_GAIN = 0.06;

// Called once per render frame with the player's current |speed| (units/sec)
// and whether gameplay is actually running (menus/pause/game-over silence it).
export function updateEngine(speed: number, active: boolean): void {
  if (!ctx || !engineOsc || !engineGain) return;
  const targetGain = active ? Math.min(1, Math.abs(speed) / 18) * ENGINE_MAX_GAIN : 0;
  const targetFreq = ENGINE_BASE_FREQ + Math.abs(speed) * ENGINE_FREQ_PER_SPEED;
  const t = now();
  engineGain.gain.setTargetAtTime(targetGain, t, 0.08);
  engineOsc.frequency.setTargetAtTime(targetFreq, t, 0.08);
}

function playerCannonFire(): void {
  tone(520, 300, 0.07, 0.18, 'square');
  noiseBurst(0.03, 0.12, 4000);
}

function enemyCannonFire(): void {
  tone(260, 150, 0.08, 0.14, 'square');
  noiseBurst(0.03, 0.09, 2200);
}

function explosion(): void {
  noiseBurst(0.35, 0.35, 1800);
  tone(220, 40, 0.35, 0.2, 'sawtooth');
}

function grenadeBlast(): void {
  noiseBurst(0.5, 0.4, 900);
  tone(90, 25, 0.5, 0.28, 'sine');
}

function flagPickup(): void {
  arpeggioUp(660, 5, 0.09, 0.2);
}

function ammoOrShieldPickup(): void {
  tone(880, 1200, 0.06, 0.16, 'sine');
}

function wallHit(): void {
  noiseBurst(0.05, 0.1, 500);
}

function playerDeath(): void {
  tone(400, 60, 0.6, 0.28, 'sawtooth');
}

function levelComplete(): void {
  fanfare();
}

// Called once per render frame with that frame's freshly-drained SimEvents.
export function updateSfx(events: SimEvent[]): void {
  if (!ctx) return;
  for (const event of events) {
    switch (event.type) {
      case 'ShotFired':
        if (event.ownerId === 'player') playerCannonFire();
        else enemyCannonFire();
        break;
      case 'WallHit':
        wallHit();
        break;
      case 'EnemyDestroyed':
        explosion();
        break;
      case 'PlayerDestroyed':
        explosion();
        playerDeath();
        break;
      case 'GrenadeExploded':
        grenadeBlast();
        break;
      case 'FlagCollected':
        flagPickup();
        break;
      case 'PickupCollected':
        ammoOrShieldPickup();
        break;
      case 'PlayerRespawned':
        // no distinct sting yet — respawn is visually blinked, audio not needed
        break;
      case 'GameOver':
        // PlayerDestroyed (same tick) already played the death sweep.
        break;
      case 'LevelComplete':
        levelComplete();
        break;
      default:
        break;
    }
  }
}
