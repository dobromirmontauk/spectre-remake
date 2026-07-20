import * as THREE from 'three';
import { SIM_DT, MAX_FRAME_DT_MS, MAX_ACCUMULATED_TICKS, PLAYER_LEFT_TOAST_MS, STALL_OVERLAY_MS } from '../config/constants.ts';
import {
  createInitialState,
  killAllEnemies,
  rebuildLevel,
  resetGameWithLoadout,
  resetGameWithRoster,
  spawnEnemyAt,
  step,
} from '../sim/simulation.ts';
import type { Command } from '../sim/commands.ts';
import type { SimEvent } from '../sim/events.ts';
import type { EnemyKind, GameMode, Loadout, PlayerSpec } from '../sim/types.ts';
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
import { NetScreens, type MatchStartInfo } from './netscreens.ts';
import { installDebugApi } from './debug.ts';
import { isMuted, resumeAudio, setMuted, toggleMuted, updateEngine, updateSfx } from '../audio/sfx.ts';
import { LocalSession, NetSession, type PlaySession } from '../net/session.ts';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const stage = document.getElementById('stage') as HTMLDivElement;
const screensRoot = document.getElementById('screens-root') as HTMLDivElement;

const state = createInitialState(1, [{ loadout: DEFAULT_LOADOUT }], 'solo');
const keyboard = new KeyboardInput();
const hud = new Hud();
const hudmp = new HudMp(stage);
const radar = new Radar(document.getElementById('radar') as HTMLCanvasElement);

// PlaySession abstraction (net/session.ts, plan §3.6): decides where each
// tick's commands come from. LocalSession is the default at boot and is
// restored any time net play ends (voluntary leave, peer-left, desync, or
// simply idling in NetLobby between matches) — see startNetMatch()/
// teardownNetSession() below.
let session: PlaySession = new LocalSession(state, keyboard);

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

// "Waiting for NAME…" lockstep stall overlay (net play only) — see
// net/lockstep.ts canStep()/session.ts NetSession.missingNames().
const stallOverlayEl = document.createElement('div');
stallOverlayEl.className = 'stall-overlay';
stage.appendChild(stallOverlayEl);

// "NAME left the game" transient toast (M5) — driven by the PlayerLeft sim
// event (see runTick below), which every peer's removePlayer() emits at the
// same tick, so this fires in sync across the match rather than at whatever
// real time each peer happened to notice the transport-level disconnect.
const playerLeftToastEl = document.createElement('div');
playerLeftToastEl.className = 'player-left-toast';
stage.appendChild(playerLeftToastEl);
let toastHideAtMs = 0;

function showPlayerLeftToast(text: string): void {
  playerLeftToastEl.textContent = text;
  toastHideAtMs = performance.now() + PLAYER_LEFT_TOAST_MS;
}

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

const netScreens = new NetScreens(screensRoot, flow, {
  onAnyInteraction: () => resumeAudio(),
  onMatchStart: (info) => startNetMatch(info),
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
  // Viewport count follows the session's local slots, not player count —
  // net play renders one full viewport (following the local player) even
  // with a full 8-player roster (see net/session.ts localSlots()).
  const split = session.localSlots().length > 1;
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

// Events accumulate across every sim tick run within a single rendered
// frame (the fixed-timestep accumulator can run several ticks per frame)
// so HUD/effects never miss a tick's events just because a later tick in
// the same frame overwrote state.events.
let frameEvents: SimEvent[] = [];

// The exact sequence net/CLAUDE.md documents as the cross-peer invariant:
// step() -> flow.handleEvents() -> flow.tick(), identical on every client
// for a given tick's `commands` AND `drops` (M5 disconnect protocol — the
// slots session.dueDrops() says to removePlayer() at this exact tick, always
// empty in local play). `session.afterTick()` runs after — it only observes
// `state` (hash exchange for net play), never mutates it.
function runTick(commands: Record<string, Command>, drops: number[]): void {
  step(state, commands, drops);
  frameEvents.push(...state.events);
  for (const event of state.events) {
    // Duel results are match wins, not a high-score run — skip the
    // leaderboard/initials flow for that mode. Net play never shows the
    // local high-score/initials flow either (see game/screens.ts).
    if (event.type === 'GameOver' && session.kind === 'local' && state.mode !== 'duel') {
      screens.notifyGameOver(event.finalScore, event.finalLevel);
    }
    if (event.type === 'PlayerLeft') {
      const name = state.players[event.slot]?.name ?? `Player ${event.slot + 1}`;
      showPlayerLeftToast(`${name} left the game`);
    }
  }
  flow.handleEvents(state);
  flow.tick();
  session.afterTick(state);
}

// State-mutating debug hooks make no sense once state is network-
// synchronized (every peer must reach a given tick via the identical
// lockstep path) — see net/CLAUDE.md and the plan's M3 debug-hooks note.
function assertLocal(action: string): void {
  if (session.kind !== 'local') throw new Error(`${action} is not available in net play — state is network-synchronized`);
}

function asNetSession(): NetSession | null {
  return session instanceof NetSession ? session : null;
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
    assertLocal('stepTicks'); // ticks are gated by the network in net play
    for (let i = 0; i < n; i++) {
      const commands = session.commandsForNextTick();
      if (commands) runTick(commands, session.dueDrops());
    }
  },
  pressCommand: (cmd: Partial<Command>, ticks: number) => {
    session.pressCommand(cmd, ticks);
  },
  setLevel: (n: number) => {
    assertLocal('setLevel');
    state.gameOver = false; // jumping levels for testing should always resume active play
    rebuildLevel(state, n);
    flow.forcePlaying();
  },
  collectAllFlags: () => {
    assertLocal('collectAllFlags');
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
    assertLocal('setGod');
    state.god = on;
  },
  spawnEnemyAt: (x: number, z: number, kind: EnemyKind = 'drone') => {
    assertLocal('spawnEnemyAt');
    spawnEnemyAt(state, x, z, kind);
  },
  killAllEnemies: () => {
    assertLocal('killAllEnemies');
    killAllEnemies(state);
  },
  setLives: (n: number) => {
    assertLocal('setLives');
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
    session.pressCommand({ fire: true }, 1);
  },
  cycleCamera: () => {
    cameraRig.cycle();
  },
  restart: () => {
    assertLocal('restart');
    flow.restart(state);
  },
  gotoMenu: () => {
    flow.goToMenu();
  },
  startGame: (loadout: Loadout = DEFAULT_LOADOUT, opts?: { mode?: GameMode; loadout2?: Loadout }) => {
    assertLocal('startGame');
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
  net: {
    host: (name) => netScreens.debugHost(name),
    join: (code, name, debugOverride) => netScreens.debugJoin(code, name, debugOverride),
    roomCode: () => netScreens.debugRoomCode(),
    roster: () => netScreens.debugRoster(),
    leave: () => netScreens.debugLeave(),
    startMatch: () => netScreens.debugStartMatch(),
    confirmedTick: () => asNetSession()?.confirmedTick() ?? 0,
    hashAtTick: (tick: number) => asNetSession()?.hashAtTick(tick),
    debugStallInject: (ms: number) => asNetSession()?.debugStallInject(ms),
    debugCorruptState: () => {
      // Nudges local state so the next HASH_INTERVAL_TICKS hash exchange
      // provably disagrees with every peer — exercises the desync path.
      // Must be a fault the sim's own invariants don't silently heal before
      // the next hash boundary (e.g. a position nudge gets snapped back in
      // bounds by the arena clamp on the very next tick — see
      // sim/CLAUDE.md's tick order) — rng.state has no such self-correction.
      state.rng.state = (state.rng.state ^ 0x1) >>> 0;
    },
  },
});

let previousFrameTime = performance.now();
let accumulator = 0;
let stallStartMs: number | null = null; // wall-clock time the current stall began, net play only

// --- Net match lifecycle (M3, disconnect protocol generalized in M5) ---
// startNetMatch() fires on every peer (host included) via NetLobby.onStart()
// (see game/netscreens.ts). A regular peer leaving mid-match no longer ends
// the match (see net/lockstep.ts's grace/drop protocol + sim/simulation.ts
// removePlayer) — only desync and the HOST leaving still tear the session
// down via showMatchEndedDialog below.

function startNetMatch(info: MatchStartInfo): void {
  resumeAudio();
  if (session instanceof NetSession) session.dispose(); // shouldn't normally happen — belt and suspenders
  const specs: PlayerSpec[] = [...info.roster]
    .sort((a, b) => a.slot - b.slot)
    .map((r) => ({ loadout: r.loadout, name: r.name }));
  resetGameWithRoster(state, specs, info.level, info.mode);
  session = new NetSession({
    transport: info.transport,
    roster: info.roster,
    selfPeerId: info.selfPeerId,
    hostPeerId: info.hostPeerId,
    keyboard,
    inputDelay: info.inputDelay,
    onDesync: () => showMatchEndedDialog('Out Of Sync', 'The game fell out of sync — match ended.'),
    onHostLeft: () => showMatchEndedDialog('Host Left', 'The host left — match ended.'),
  });
  stallStartMs = null;
  flow.beginRun();
}

function teardownNetSession(): void {
  if (session instanceof NetSession) session.dispose();
  session = new LocalSession(state, keyboard);
  stallStartMs = null;
}

// Abnormal match end (peer left / desync) — v1 "simple" handling: freeze,
// show the dialog, full teardown back to NetMenu on acknowledge.
function showMatchEndedDialog(title: string, message: string): void {
  flow.paused = true;
  netScreens.showMatchEndedDialog(title, message, () => {
    teardownNetSession();
    netScreens.forceLeaveMatch();
  });
}

function handleEdgeKeys(): void {
  // Camera cycling is allowed whenever there's exactly one local viewport —
  // true solo AND net play (which always renders one viewport following the
  // local player, however many players are in the match) — but not local
  // split-screen (see cameraRig2 comment above).
  const singleViewport = session.localSlots().length <= 1;
  if (keyboard.consumeJustPressed('Tab') && singleViewport) cameraRig.cycle();
  if ((keyboard.consumeJustPressed('p') || keyboard.consumeJustPressed('P')) && session.isPauseAllowed()) flow.togglePause();
  // 'M' always toggles mute; the legacy 'S' toggle is 1P-only since 2P's
  // player2 uses S for reverse thrust (WASD scheme) — see input/keyboard.ts.
  if (keyboard.consumeJustPressed('m') || keyboard.consumeJustPressed('M')) hud.updateMute(toggleMuted());
  if (singleViewport && (keyboard.consumeJustPressed('s') || keyboard.consumeJustPressed('S'))) hud.updateMute(toggleMuted());

  if (keyboard.consumeJustPressed('Escape')) {
    if (screens.isDialogOpen) screens.closeDialog();
    else if (netScreens.isDialogOpen || netScreens.isLeaveConfirmOpen) netScreens.handleEscape();
    else if (session.kind === 'net' && flow.isGameplayActive) {
      netScreens.requestLeaveConfirm(() => {
        teardownNetSession();
        netScreens.forceLeaveMatch();
      });
    } else if (flow.showConfirmQuit) flow.cancelQuitToMenu();
    else if (flow.isGameplayActive) flow.requestQuitToMenu();
    else if (flow.showTankSetup) screens.backFromTankSetup();
    else if (flow.showModeSelect) flow.goToMenu();
    else netScreens.handleEscape();
  }

  if (keyboard.consumeJustPressed('Enter') && flow.showGameOver) {
    if (session.kind === 'net') {
      teardownNetSession();
      netScreens.returnToLobbyAfterMatch();
      flow.goToNetLobby();
    } else {
      screens.handleGameOverEnter();
    }
  }
}

function renderSplitScreen(dtSeconds: number): void {
  const halfW = Math.floor(canvasWidthPx / 2);
  const rightW = canvasWidthPx - halfW;
  threeRenderer.setScissorTest(true);

  // Local split-screen only ever shows slots 0/1 (session.localSlots() is
  // [0,1] exactly when split — see net/session.ts LocalSession.localSlots()).
  const [slot0, slot1] = session.localSlots();
  const pose0 = gameRenderer.getPlayerRenderPose(state.players[slot0 ?? 0]?.id ?? 'player');
  const pose1 = gameRenderer.getPlayerRenderPose(state.players[slot1 ?? 1]?.id ?? 'player2');

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
  let stalled = false;
  if (simActive) {
    accumulator += frameDt / 1000;
    const maxAccumSeconds = MAX_ACCUMULATED_TICKS * SIM_DT;
    if (accumulator > maxAccumSeconds) accumulator = maxAccumSeconds;

    while (accumulator >= SIM_DT) {
      const commands = session.commandsForNextTick();
      if (!commands) {
        // Net play only — a live slot's command for this tick hasn't
        // arrived yet. Freeze the accumulator (don't let it build up a
        // burst of ticks to fire off once we catch up) and keep rendering
        // the last confirmed state (see net/CLAUDE.md, plan §3.6).
        accumulator = SIM_DT;
        stalled = true;
        break;
      }
      runTick(commands, session.dueDrops());
      accumulator -= SIM_DT;
    }
  }

  if (stalled) {
    if (stallStartMs === null) stallStartMs = now;
  } else {
    stallStartMs = null;
  }
  const showStallOverlay = stalled && stallStartMs !== null && now - stallStartMs >= STALL_OVERLAY_MS;
  stallOverlayEl.classList.toggle('visible', showStallOverlay);
  if (showStallOverlay) stallOverlayEl.textContent = `Waiting for ${session.missingNames().join(', ')}…`;

  playerLeftToastEl.classList.toggle('visible', now < toastHideAtMs);

  const alpha = simActive ? accumulator / SIM_DT : 1;
  const dtSeconds = simActive ? frameDt / 1000 : 0;

  gameRenderer.update(state, alpha, now / 1000);
  effects.update(frameEvents, dtSeconds);
  updateSfx(frameEvents);

  const localSlots = session.localSlots();
  const mySlot = localSlots[0] ?? 0;
  const myPlayer = state.players[mySlot] ?? state.players[0];
  updateEngine(myPlayer?.speed ?? 0, simActive);

  // `split` = dual-viewport rendering (local 2P only — net play always
  // renders ONE viewport, following the local player, regardless of roster
  // size); `multiplayer` = HUD/radar selection (hudmp vs the solo Hud),
  // which also applies to net play. See net/session.ts localSlots() and
  // src/hud/style.css's data-splitscreen/data-multiplayer split.
  const split = localSlots.length > 1;
  const multiplayer = state.players.length > 1;
  stage.dataset.splitscreen = split ? 'true' : 'false';
  stage.dataset.multiplayer = multiplayer ? 'true' : 'false';
  hud.updateMute(isMuted()); // #hud-mute stays visible/shared in both solo and split layouts
  // hudmp.update() always runs (even in solo) because it self-hides via its
  // own 'visible' class toggle — skipping the call when !multiplayer would
  // leave that class (and the panel) stuck from the last 2P/net session.
  hudmp.update(state);
  if (multiplayer) {
    if (split) {
      if (myPlayer) radar.update(state, myPlayer);
      const other = state.players[localSlots[1] ?? 1] ?? myPlayer;
      if (other) radar2.update(state, other);
    } else if (myPlayer) {
      radar.update(state, myPlayer); // net play: single radar follows the local player
    }
  } else {
    hud.update(state, flow);
    if (myPlayer) radar.update(state, myPlayer);
  }
  screens.update();
  netScreens.update();

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
    const pose0 = gameRenderer.getPlayerRenderPose(myPlayer?.id ?? 'player');
    if (pose0) cameraRig.update(pose0.position, pose0.heading, dtSeconds);
    threeRenderer.render(scene, cameraRig.activeCamera);
  }
}
requestAnimationFrame(frame);
