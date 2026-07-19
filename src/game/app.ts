import * as THREE from 'three';
import { SIM_DT, MAX_FRAME_DT_MS, MAX_ACCUMULATED_TICKS } from '../config/constants.ts';
import {
  createInitialState,
  killAllEnemies,
  rebuildLevel,
  resetGameWithLoadout,
  spawnEnemyAt,
  step,
} from '../sim/simulation.ts';
import type { Command } from '../sim/commands.ts';
import { NEUTRAL_COMMAND } from '../sim/commands.ts';
import type { SimEvent } from '../sim/events.ts';
import type { EnemyKind, GameMode, Loadout } from '../sim/types.ts';
import { DEFAULT_LOADOUT } from '../config/constants.ts';
import { KeyboardInput } from '../input/keyboard.ts';
import { Renderer } from '../render/renderer.ts';
import { CameraRig } from '../render/cameras.ts';
import { EffectsManager } from '../render/effects.ts';
import { hashState } from '../sim/hash.ts';
import { applyPixelatedSize } from '../render/retro.ts';
import { isFilledMode, setFilledMode } from '../render/meshes.ts';
import { Hud } from '../hud/hud.ts';
import { HudMp } from '../hud/hudmp.ts';
import { Radar } from '../hud/radar.ts';
import { GameFlow } from './flow.ts';
import { Screens } from './screens.ts';
import { installDebugApi } from './debug.ts';
import { isMuted, resumeAudio, setMuted, toggleMuted, updateEngine, updateSfx } from '../audio/sfx.ts';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const stage = document.getElementById('stage') as HTMLDivElement;
const screensRoot = document.getElementById('screens-root') as HTMLDivElement;

const state = createInitialState(1, [{ loadout: DEFAULT_LOADOUT }], 'solo');
const keyboard = new KeyboardInput();
const hud = new Hud();
const hudmp = new HudMp(stage);
const radar = new Radar(document.getElementById('radar') as HTMLCanvasElement);

// Second radar canvas for player2's viewport corner in 2P modes — created
// here rather than in index.html so the solo markup stays untouched.
const radarCanvas2 = document.createElement('canvas');
radarCanvas2.id = 'radar2';
radarCanvas2.width = 96;
radarCanvas2.height = 96;
stage.appendChild(radarCanvas2);
const radar2 = new Radar(radarCanvas2);

const splitDivider = document.createElement('div');
splitDivider.className = 'split-divider';
stage.appendChild(splitDivider);

const flow = new GameFlow();

const threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
// P1's rig (also the only rig used in solo mode); P2's rig only drives a
// camera when a second local player is present (2P co-op/duel) — see
// render(). Camera cycling (Tab) is disabled in 2P modes and both rigs stay
// in their default 'chase' mode (see handleEdgeKeys) — simplest choice for
// split-screen, noted in the multiplayer report. Local split-screen only
// ever shows slots 0/1 — net play (M2+) renders one full viewport for the
// local player regardless of roster size (see plan Design §3).
const cameraRig = new CameraRig(stage.clientWidth / stage.clientHeight);
const cameraRig2 = new CameraRig(stage.clientWidth / stage.clientHeight);
const gameRenderer = new Renderer(scene, state);
const effects = new EffectsManager(scene);

const screens = new Screens(screensRoot, flow, state, {
  getFilled: () => isFilledMode(),
  toggleFilled: () => {
    const next = !isFilledMode();
    setFilledMode(next);
    return next;
  },
  getMuted: () => isMuted(),
  toggleMuted: () => toggleMuted(),
  onAnyInteraction: () => resumeAudio(),
});

let canvasWidthPx = 0;
let canvasHeightPx = 0;

function resize(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  canvasWidthPx = w;
  canvasHeightPx = h;
  applyPixelatedSize(threeRenderer, canvas, w, h);
  updateCameraAspects();
}
function updateCameraAspects(): void {
  const split = state.players.length > 1;
  if (split) {
    const halfAspect = canvasWidthPx / 2 / canvasHeightPx;
    cameraRig.setAspect(halfAspect);
    cameraRig2.setAspect(halfAspect);
  } else {
    cameraRig.setAspect(canvasWidthPx / canvasHeightPx);
  }
}
resize();
window.addEventListener('resize', resize);

let commandOverride: { command: Command; ticksRemaining: number } | null = null;

function resolveCommand(): Command {
  if (commandOverride) {
    const cmd = commandOverride.command;
    commandOverride.ticksRemaining--;
    if (commandOverride.ticksRemaining <= 0) commandOverride = null;
    return cmd;
  }
  return keyboard.readCommand();
}

// Events accumulate across every sim tick run within a single rendered
// frame (the fixed-timestep accumulator can run several ticks per frame)
// so HUD/effects never miss a tick's events just because a later tick in
// the same frame overwrote state.events.
let frameEvents: SimEvent[] = [];

function runTick(): void {
  // Only slots 0/1 have a local input source (keyboard) today — net play
  // (M2+) feeds remaining slots from received peer input instead.
  const commands: Record<string, Command> = {};
  const [p0, p1] = state.players;
  if (p0) commands[p0.id] = resolveCommand();
  if (p1) commands[p1.id] = keyboard.readCommand2();
  step(state, commands);
  frameEvents.push(...state.events);
  for (const event of state.events) {
    // Duel results are match wins, not a high-score run — skip the
    // leaderboard/initials flow for that mode (see game/screens.ts).
    if (event.type === 'GameOver' && state.mode !== 'duel') screens.notifyGameOver(event.finalScore, event.finalLevel);
  }
  flow.handleEvents(state);
  flow.tick();
}

installDebugApi({
  getState: () => JSON.parse(JSON.stringify(state)) as unknown,
  pause: () => {
    flow.paused = true;
  },
  resume: () => {
    flow.paused = false;
  },
  stepTicks: (n: number) => {
    for (let i = 0; i < n; i++) runTick();
  },
  pressCommand: (cmd: Partial<Command>, ticks: number) => {
    commandOverride = { command: { ...NEUTRAL_COMMAND, ...cmd }, ticksRemaining: ticks };
  },
  setLevel: (n: number) => {
    state.gameOver = false; // jumping levels for testing should always resume active play
    rebuildLevel(state, n);
    flow.forcePlaying();
  },
  collectAllFlags: () => {
    for (const flag of state.flags) {
      if (flag.collected) continue;
      flag.collected = true;
      state.flagsCollected++;
    }
    state.score += state.bonusRemaining;
    state.events = [{ type: 'LevelComplete', level: state.level }];
    flow.handleEvents(state);
  },
  setGod: (on: boolean) => {
    state.god = on;
  },
  spawnEnemyAt: (x: number, z: number, kind: EnemyKind = 'drone') => {
    spawnEnemyAt(state, x, z, kind);
  },
  killAllEnemies: () => {
    killAllEnemies(state);
  },
  setLives: (n: number) => {
    const p0 = state.players[0];
    if (!p0) return;
    p0.lives = n;
    if (n > 0 && state.gameOver) {
      state.gameOver = false;
      p0.alive = true;
      flow.forcePlaying();
    }
  },
  fire: () => {
    commandOverride = { command: { ...NEUTRAL_COMMAND, fire: true }, ticksRemaining: 1 };
  },
  cycleCamera: () => {
    cameraRig.cycle();
  },
  restart: () => {
    flow.restart(state);
  },
  gotoMenu: () => {
    flow.goToMenu();
  },
  startGame: (loadout: Loadout = DEFAULT_LOADOUT, opts?: { mode?: GameMode; loadout2?: Loadout }) => {
    resumeAudio();
    resetGameWithLoadout(state, loadout, 1, opts);
    flow.beginRun();
  },
  setFilled: (on: boolean) => {
    setFilledMode(on);
  },
  setMuted: (on: boolean) => {
    setMuted(on);
  },
  hashState: () => hashState(state),
});

let previousFrameTime = performance.now();
let accumulator = 0;

function handleEdgeKeys(): void {
  const isSolo = state.players.length <= 1;
  if (keyboard.consumeJustPressed('Tab') && isSolo) cameraRig.cycle(); // camera cycling is 1P-only (see cameraRig2 comment above)
  if (keyboard.consumeJustPressed('p') || keyboard.consumeJustPressed('P')) flow.togglePause();
  // 'M' always toggles mute; the legacy 'S' toggle is 1P-only since 2P's
  // player2 uses S for reverse thrust (WASD scheme) — see input/keyboard.ts.
  if (keyboard.consumeJustPressed('m') || keyboard.consumeJustPressed('M')) hud.updateMute(toggleMuted());
  if (isSolo && (keyboard.consumeJustPressed('s') || keyboard.consumeJustPressed('S'))) hud.updateMute(toggleMuted());

  if (keyboard.consumeJustPressed('Escape')) {
    if (screens.isDialogOpen) screens.closeDialog();
    else if (flow.showConfirmQuit) flow.cancelQuitToMenu();
    else if (flow.isGameplayActive) flow.requestQuitToMenu();
    else if (flow.showTankSetup) screens.backFromTankSetup();
    else if (flow.showModeSelect) flow.goToMenu();
  }

  if (keyboard.consumeJustPressed('Enter') && flow.showGameOver) screens.handleGameOverEnter();
}

function renderSplitScreen(dtSeconds: number): void {
  const halfW = Math.floor(canvasWidthPx / 2);
  const rightW = canvasWidthPx - halfW;
  threeRenderer.setScissorTest(true);

  const pose0 = gameRenderer.getPlayerRenderPose('player');
  const pose1 = gameRenderer.getPlayerRenderPose('player2');

  threeRenderer.setViewport(0, 0, halfW, canvasHeightPx);
  threeRenderer.setScissor(0, 0, halfW, canvasHeightPx);
  if (pose0) cameraRig.chase.update(pose0.position, pose0.heading, dtSeconds);
  threeRenderer.render(scene, cameraRig.chase.camera);

  threeRenderer.setViewport(halfW, 0, rightW, canvasHeightPx);
  threeRenderer.setScissor(halfW, 0, rightW, canvasHeightPx);
  if (pose1) cameraRig2.chase.update(pose1.position, pose1.heading, dtSeconds);
  threeRenderer.render(scene, cameraRig2.chase.camera);

  threeRenderer.setScissorTest(false);
}

function frame(now: number): void {
  requestAnimationFrame(frame);

  let frameDt = now - previousFrameTime;
  previousFrameTime = now;
  if (frameDt > MAX_FRAME_DT_MS) frameDt = MAX_FRAME_DT_MS;

  handleEdgeKeys();

  frameEvents = [];
  const simActive = flow.isGameplayActive && !flow.paused;
  if (simActive) {
    accumulator += frameDt / 1000;
    const maxAccumSeconds = MAX_ACCUMULATED_TICKS * SIM_DT;
    if (accumulator > maxAccumSeconds) accumulator = maxAccumSeconds;

    while (accumulator >= SIM_DT) {
      runTick();
      accumulator -= SIM_DT;
    }
  }

  const alpha = simActive ? accumulator / SIM_DT : 1;
  const dtSeconds = simActive ? frameDt / 1000 : 0;

  gameRenderer.update(state, alpha, now / 1000);
  effects.update(frameEvents, dtSeconds);
  updateSfx(frameEvents);
  updateEngine(state.players[0]?.speed ?? 0, simActive);

  const split = state.players.length > 1;
  stage.dataset.splitscreen = split ? 'true' : 'false';
  hud.updateMute(isMuted()); // #hud-mute stays visible/shared in both solo and split layouts
  // hudmp.update() always runs (even in solo) because it self-hides via its
  // own 'visible' class toggle — skipping the call when !split would leave
  // that class (and the panel) stuck from the last 2P session.
  hudmp.update(state);
  const p0 = state.players[0];
  if (split) {
    if (p0) radar.update(state, p0);
    if (p0) radar2.update(state, state.players[1] ?? p0);
  } else {
    hud.update(state, flow);
    if (p0) radar.update(state, p0);
  }
  screens.update();

  updateCameraAspects();
  stage.dataset.camera = cameraRig.mode;
  if (split) {
    renderSplitScreen(dtSeconds);
  } else {
    // Explicitly reset viewport/scissor to the full canvas — a previous
    // frame's split-screen render leaves the WebGLRenderer's viewport
    // latched to a half-width rectangle otherwise, and render() doesn't
    // reset it on its own.
    threeRenderer.setScissorTest(false);
    threeRenderer.setViewport(0, 0, canvasWidthPx, canvasHeightPx);
    const pose0 = gameRenderer.getPlayerRenderPose('player');
    if (pose0) cameraRig.update(pose0.position, pose0.heading, dtSeconds);
    threeRenderer.render(scene, cameraRig.activeCamera);
  }
}
requestAnimationFrame(frame);
