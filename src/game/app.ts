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
import type { EnemyKind, Loadout } from '../sim/types.ts';
import { DEFAULT_LOADOUT } from '../config/constants.ts';
import { KeyboardInput } from '../input/keyboard.ts';
import { Renderer } from '../render/renderer.ts';
import { CameraRig } from '../render/cameras.ts';
import { EffectsManager } from '../render/effects.ts';
import { applyPixelatedSize } from '../render/retro.ts';
import { isFilledMode, setFilledMode } from '../render/meshes.ts';
import { Hud } from '../hud/hud.ts';
import { Radar } from '../hud/radar.ts';
import { GameFlow } from './flow.ts';
import { Screens } from './screens.ts';
import { installDebugApi } from './debug.ts';
import { isMuted, resumeAudio, setMuted, toggleMuted, updateEngine, updateSfx } from '../audio/sfx.ts';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const stage = document.getElementById('stage') as HTMLDivElement;
const screensRoot = document.getElementById('screens-root') as HTMLDivElement;

const state = createInitialState(1, DEFAULT_LOADOUT);
const keyboard = new KeyboardInput();
const hud = new Hud();
const radar = new Radar();
const flow = new GameFlow();

const threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
const cameraRig = new CameraRig(stage.clientWidth / stage.clientHeight);
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

function resize(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  applyPixelatedSize(threeRenderer, canvas, w, h);
  cameraRig.setAspect(w / h);
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
  const cmd = resolveCommand();
  step(state, { [state.player.id]: cmd });
  frameEvents.push(...state.events);
  for (const event of state.events) {
    if (event.type === 'GameOver') screens.notifyGameOver(event.finalScore, event.finalLevel);
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
    state.lives = n;
    if (n > 0 && state.gameOver) {
      state.gameOver = false;
      state.player.alive = true;
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
  startGame: (loadout: Loadout = DEFAULT_LOADOUT) => {
    resumeAudio();
    resetGameWithLoadout(state, loadout, 1);
    flow.beginRun();
  },
  setFilled: (on: boolean) => {
    setFilledMode(on);
  },
  setMuted: (on: boolean) => {
    setMuted(on);
  },
});

let previousFrameTime = performance.now();
let accumulator = 0;

function handleEdgeKeys(): void {
  if (keyboard.consumeJustPressed('Tab')) cameraRig.cycle();
  if (keyboard.consumeJustPressed('p') || keyboard.consumeJustPressed('P')) flow.togglePause();
  if (keyboard.consumeJustPressed('s') || keyboard.consumeJustPressed('S')) hud.updateMute(toggleMuted());

  if (keyboard.consumeJustPressed('Escape')) {
    if (screens.isDialogOpen) screens.closeDialog();
    else if (flow.showConfirmQuit) flow.cancelQuitToMenu();
    else if (flow.isGameplayActive) flow.requestQuitToMenu();
    else if (flow.showTankSetup) flow.goToMenu();
  }

  if (keyboard.consumeJustPressed('Enter') && flow.showGameOver) screens.handleGameOverEnter();
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
  updateEngine(state.player.speed, simActive);
  hud.update(state, flow);
  hud.updateMute(isMuted());
  radar.update(state);
  screens.update();
  stage.dataset.camera = cameraRig.mode;
  cameraRig.update(gameRenderer.playerRenderPosition, gameRenderer.playerRenderHeading, dtSeconds);
  threeRenderer.render(scene, cameraRig.activeCamera);
}
requestAnimationFrame(frame);
