import type { EnemyState, GameMode, GameState, Loadout, PlayerSpec, PlayerState, TankState, Vec2 } from './types.ts';
import type { Command } from './commands.ts';
import { NEUTRAL_COMMAND } from './commands.ts';
import type { SimEvent } from './events.ts';
import { applyMovement, deriveMovementParams } from './movement.ts';
import { circleVsAABB, circleVsCircle, containInArena } from './collision.ts';
import { buildLevel, hashLevel, type LevelLayout } from './levelgen.ts';
import { createRng } from './rng.ts';
import {
  buildEnemyRoster,
  createEnemy,
  enemyCommand,
  movementParamsForEnemy,
  pickEdgeSpawnPoint,
  updateStuckDetection,
} from './ai.ts';
import { fireGrenade, fireProjectile, nextId, updateGrenades, updateProjectiles } from './weapons.ts';
import { levelConfig, type LevelConfig } from '../config/levels.ts';
import {
  AMMO_PER_SHOT,
  ARENA_HALF_SIZE,
  BONUS_DECAY_INTERVAL_TICKS,
  BONUS_START,
  COOP_SPAWN_POINTS,
  DEFAULT_LOADOUT,
  DUEL_KILL_TARGET,
  DUEL_RESPAWN_INVULN_TICKS,
  DUEL_RESPAWN_TICKS,
  DUEL_SPAWN_POINTS,
  ENEMY_RESPAWN_TICKS,
  ENEMY_SEED_SALT,
  ENEMY_TANK_RADIUS,
  FLAG_COLLECT_RADIUS,
  GRENADE_AMMO_COST,
  GRENADE_COOLDOWN_TICKS,
  HUNTER_SHIELD_BONUS,
  LEVELGEN_SEED_BASE,
  PICKUP_COLLECT_RADIUS,
  PLAYER_FIRE_COOLDOWN_TICKS,
  PLAYER_LIVES_START,
  PLAYER_RESPAWN_INVULN_TICKS,
  REFILL_ON_LEVEL_START,
  SCORE_ENEMY_KILL,
  SCORE_FLAG,
  SIM_DT,
  TANK_RADIUS,
  WALL_STOPS_DEAD,
  WINDMILL_SPIN_RATE,
  type SpawnPoint,
} from '../config/constants.ts';

// Tank id strings stay 'player'/'player2' for slots 0/1 (existing events,
// kill credit, and Playwright expectations all key off those two strings —
// see sim/types.ts PlayerState); slots above that use 'player3'..'player8'.
// Exported for net/session.ts, which maps lockstep slot numbers back to
// tank ids when building the commands record step() expects.
export function playerIdForSlot(slot: number): string {
  return slot === 0 ? 'player' : slot === 1 ? 'player2' : `player${slot + 1}`;
}

function defaultPlayerName(slot: number): string {
  return `Player ${slot + 1}`;
}

// Where a player tank appears at the start of a level (solo/coop) or after a
// duel respawn — a fixed per-slot table (config/constants.ts), not computed
// trig, so it stays reproducible from (slot, mode) alone. Slots 0/1 exactly
// reproduce the pre-refactor solo/coop/duel spawns.
function spawnForSlot(slot: number, mode: GameMode): SpawnPoint {
  const table = mode === 'duel' ? DUEL_SPAWN_POINTS : COOP_SPAWN_POINTS;
  return table[slot] ?? table[table.length - 1]!;
}

function applySpawn(tank: TankState, spawn: SpawnPoint): void {
  tank.position = { x: spawn.x, z: spawn.z };
  tank.prevPosition = { x: spawn.x, z: spawn.z };
  tank.heading = spawn.heading;
  tank.prevHeading = spawn.heading;
  tank.speed = 0;
}

function createPlayerState(slot: number, loadout: Loadout, name: string): PlayerState {
  return {
    id: playerIdForSlot(slot),
    slot,
    position: { x: 0, z: 0 },
    prevPosition: { x: 0, z: 0 },
    heading: 0,
    prevHeading: 0,
    speed: 0,
    shield: loadout.shields,
    maxShield: loadout.shields,
    ammo: loadout.ammo,
    maxAmmo: loadout.ammo,
    alive: true,
    fireCooldown: 0,
    grenadeCooldown: 0,
    invulnerableTicks: 0,
    lastHitBy: null,
    respawnTicksRemaining: 0,
    lives: PLAYER_LIVES_START,
    kills: 0,
    loadout,
    movement: deriveMovementParams(loadout),
    name,
  };
}

// Every alive human-controlled tank this tick — the shared collection point
// for co-op flag/pickup pickup (AI targeting has its own iteration in
// ai.ts's nearestAlivePlayer, which needs early-out-free access to state.players).
export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.alive);
}

function enemySeedFor(level: number): number {
  return (LEVELGEN_SEED_BASE ^ hashLevel(level) ^ ENEMY_SEED_SALT) >>> 0;
}

// Duel has no AI combatants at all; solo/coop use the usual level roster.
// Roster enemy ids are level-qualified (`enemy-L{level}-{i}`) rather than
// drawn from a session-lifetime counter — see ai.ts createEnemy's doc
// comment for why (reconstructibility from (state, commands) alone, and
// cross-peer hash agreement). They stay unique across levels (needed
// because the renderer caches meshes by id and never re-checks `kind`).
function buildEnemies(level: number, mode: GameMode): EnemyState[] {
  if (mode === 'duel') return [];
  const cfg = levelConfig(level);
  return buildEnemyRoster(enemySeedFor(level), cfg).map((spec, i) => createEnemy(spec.position, spec.kind, cfg, `enemy-L${level}-${i}`));
}

// Duel has no flags (kill-count decides the match, not a level clear) —
// obstacles/pickups still populate so there's cover and restocks to fight over.
function layoutForMode(level: number, mode: GameMode): LevelLayout {
  const layout = buildLevel(level);
  if (mode === 'duel') return { ...layout, flags: [] };
  return layout;
}

// Builds a brand-new GameState for `specs.length` players (array index =
// slot). Solo is just `[{ loadout }]`, mode defaulted to 'solo'.
export function createInitialState(level: number, specs: PlayerSpec[], mode: GameMode = 'solo'): GameState {
  const layout = layoutForMode(level, mode);

  const players: PlayerState[] = specs.map((spec, slot) => {
    const player = createPlayerState(slot, spec.loadout, spec.name ?? defaultPlayerName(slot));
    applySpawn(player, spawnForSlot(slot, mode));
    return player;
  });

  return {
    tick: 0,
    level,
    rng: createRng(LEVELGEN_SEED_BASE ^ level),
    mode,
    players,
    obstacles: layout.obstacles,
    flags: layout.flags,
    pickups: layout.pickups,
    flagsCollected: 0,
    enemies: buildEnemies(level, mode),
    projectiles: [],
    grenades: [],
    score: 0,
    bonusRemaining: BONUS_START,
    winner: null,
    gameOver: false,
    god: false,
    nextEntityId: 0,
    events: [],
  };
}

// Resets one player tank to its level-start spawn, revived and topped up.
// Called by rebuildLevel for every present player — this is what makes a
// co-op player eliminated (0 lives) earlier in the level come back the
// moment the level clears, with no special-casing needed here.
function resetPlayerForLevel(state: GameState, player: PlayerState): void {
  applySpawn(player, spawnForSlot(player.slot, state.mode));
  player.alive = true;
  player.fireCooldown = 0;
  player.grenadeCooldown = 0;
  player.invulnerableTicks = 0;
  player.respawnTicksRemaining = 0;
  player.lastHitBy = null;
  if (REFILL_ON_LEVEL_START) {
    player.shield = player.maxShield;
    player.ammo = player.maxAmmo;
  }
}

// Rebuilds the arena for `level` in place, resetting all present players to
// spawn and repopulating enemies. Called by game/flow.ts on LevelComplete, or
// directly by debug hooks. Lives/score/god persist across levels; only a full
// resetGameWithRoster()/resetGameWithLoadout() clears those.
export function rebuildLevel(state: GameState, level: number): void {
  const layout = layoutForMode(level, state.mode);
  state.level = level;
  state.obstacles = layout.obstacles;
  state.flags = layout.flags;
  state.pickups = layout.pickups;
  state.flagsCollected = 0;
  state.enemies = buildEnemies(level, state.mode);
  state.projectiles = [];
  state.grenades = [];
  state.bonusRemaining = BONUS_START;

  for (const player of state.players) resetPlayerForLevel(state, player);
}

// Full reset to a fresh game keeping the CURRENT roster/mode/loadouts —
// used by the debug `restart` hook (game/flow.ts's Enter-to-restart fast
// path, bypassing the menu/tank-setup flow for deterministic tests). Revives
// every player and clears lives/kills/score/winner; use resetGameWithRoster
// (or the resetGameWithLoadout wrapper) to change the roster/mode itself.
export function resetGame(state: GameState): void {
  state.tick = 0;
  state.score = 0;
  state.winner = null;
  state.gameOver = false;
  for (const player of state.players) {
    player.lives = PLAYER_LIVES_START;
    player.kills = 0;
  }
  rebuildLevel(state, 1);
}

// Full reset to a fresh game with a chosen player roster/mode — used by the
// tank-setup screen's "Start" button and the debug `startGame` hook. Array
// index of `specs` becomes the player's slot (0-7); slots 0/1 keep the
// 'player'/'player2' ids so existing events/kill-credit/tests keep working.
export function resetGameWithRoster(state: GameState, specs: PlayerSpec[], level = 1, mode: GameMode = 'solo'): void {
  state.mode = mode;
  state.players = specs.map((spec, slot) => createPlayerState(slot, spec.loadout, spec.name ?? defaultPlayerName(slot)));
  state.tick = 0;
  state.score = 0;
  state.winner = null;
  state.gameOver = false;
  rebuildLevel(state, level); // spawns + refills shield/ammo to the new maxes (REFILL_ON_LEVEL_START)
}

// Thin wrapper preserving the exact pre-refactor call signature (loadout,
// level, {mode, loadout2}) so screens.ts/debug.ts/app.ts call sites are
// unchanged — omitting `opts` reproduces the original 1-player-only behavior
// exactly. Only ever produces 1 (solo) or 2 (coop/duel) players; use
// resetGameWithRoster directly for 3-8 (net play, M2+).
export function resetGameWithLoadout(
  state: GameState,
  loadout: Loadout,
  level = 1,
  opts: { mode?: GameMode; loadout2?: Loadout } = {},
): void {
  const mode = opts.mode ?? 'solo';
  const specs: PlayerSpec[] = mode === 'solo' ? [{ loadout }] : [{ loadout }, { loadout: opts.loadout2 ?? DEFAULT_LOADOUT }];
  resetGameWithRoster(state, specs, level, mode);
}

function resolveObstacleCollisionsFor(tank: TankState, state: GameState, radius: number, events: SimEvent[], emitWallHit: boolean): void {
  for (const obstacle of state.obstacles) {
    const hit =
      obstacle.kind === 'wall'
        ? circleVsAABB(tank.position, radius, obstacle.min, obstacle.max)
        : circleVsCircle(tank.position, radius, obstacle.position, obstacle.pylonRadius);

    if (!hit.hit) continue;

    tank.position.x += hit.normal.x * hit.penetration;
    tank.position.z += hit.normal.z * hit.penetration;
    if (WALL_STOPS_DEAD) tank.speed = 0;
    if (emitWallHit) events.push({ type: 'WallHit', obstacleId: obstacle.id });
  }
}

function resolveArenaBoundsFor(tank: TankState, radius: number, events: SimEvent[], emitWallHit: boolean): void {
  const contained = containInArena(tank.position, radius, ARENA_HALF_SIZE);
  if (contained.hitWall) {
    tank.position.x = contained.x;
    tank.position.z = contained.z;
    if (WALL_STOPS_DEAD) tank.speed = 0;
    if (emitWallHit) events.push({ type: 'WallHit', obstacleId: 'arena-bounds' });
  }
}

// Tanks are solid: mutual circle-vs-circle push-out for every alive pair
// (any player vs any enemy, player vs player, enemy vs enemy), resolved after
// each tank's own obstacle/arena-bounds collision. Position-only (no speed
// change) — matches the plan's "tanks/flags/pickups = circles" 2D collision
// model.
function resolveTankVsTankCollisions(state: GameState): void {
  const tanks: TankState[] = [...state.players, ...state.enemies].filter((t) => t.alive);
  for (let i = 0; i < tanks.length; i++) {
    for (let j = i + 1; j < tanks.length; j++) {
      const a = tanks[i]!;
      const b = tanks[j]!;
      const hit = circleVsCircle(a.position, TANK_RADIUS, b.position, TANK_RADIUS);
      if (!hit.hit) continue;
      const half = hit.penetration / 2;
      a.position.x += hit.normal.x * half;
      a.position.z += hit.normal.z * half;
      b.position.x -= hit.normal.x * half;
      b.position.z -= hit.normal.z * half;
    }
  }
}

// Tank-vs-tank push-out has no idea about obstacles or the arena boundary,
// so a ram at the wall can shove a tank through it — nothing else in the
// tick re-clamps that. This is the corrective final pass: re-run each alive
// tank's own obstacle/arena-bounds resolution one more time, after the
// pairwise push-out. It intentionally discards events (this is a safety-net
// correction, not new gameplay feedback — the tank already got its WallHit
// this tick if it earned one) and must remain the last spatial/collision
// operation in step(); nothing after this may move a tank via physics
// (the only position writes afterward are hardcoded-safe teleports: player
// respawn to spawn point, enemy respawn to an edge point already well
// inside bounds).
function resolveFinalStaticPass(state: GameState): void {
  const discard: SimEvent[] = [];
  for (const player of state.players) {
    if (!player.alive) continue;
    resolveObstacleCollisionsFor(player, state, TANK_RADIUS, discard, false);
    resolveArenaBoundsFor(player, TANK_RADIUS, discard, false);
  }
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    resolveObstacleCollisionsFor(enemy, state, ENEMY_TANK_RADIUS, discard, false);
    resolveArenaBoundsFor(enemy, ENEMY_TANK_RADIUS, discard, false);
  }
}

function advanceWindmills(state: GameState): void {
  for (const obstacle of state.obstacles) {
    if (obstacle.kind !== 'windmill') continue;
    obstacle.prevBladeAngle = obstacle.bladeAngle;
    obstacle.bladeAngle += WINDMILL_SPIN_RATE * SIM_DT;
  }
}

// Duel has no flags at all (see layoutForMode); co-op's 10 flags are shared —
// any alive player can collect one and all of them count toward the same total.
function resolveFlags(state: GameState, events: SimEvent[]): void {
  if (state.mode === 'duel' || state.flags.length === 0) return;
  const collectors = alivePlayers(state);
  for (const flag of state.flags) {
    if (flag.collected) continue;
    for (const player of collectors) {
      const hit = circleVsCircle(player.position, TANK_RADIUS, flag.position, FLAG_COLLECT_RADIUS);
      if (!hit.hit) continue;
      flag.collected = true;
      state.flagsCollected++;
      state.score += SCORE_FLAG;
      events.push({ type: 'FlagCollected', flagId: flag.id, flagsCollected: state.flagsCollected });
      break;
    }
  }

  if (state.flagsCollected >= state.flags.length) {
    state.score += state.bonusRemaining;
    events.push({ type: 'LevelComplete', level: state.level });
  }
}

// Any alive player can pick up ammo/shield pickups; applies to whichever
// player actually touched it (co-op players don't share ammo/shield pools).
function resolvePickups(state: GameState, events: SimEvent[]): void {
  const collectors = alivePlayers(state);
  for (const pickup of state.pickups) {
    if (pickup.collected) continue;
    for (const player of collectors) {
      const hit = circleVsCircle(player.position, TANK_RADIUS, pickup.position, PICKUP_COLLECT_RADIUS);
      if (!hit.hit) continue;

      pickup.collected = true;
      if (pickup.kind === 'ammo') {
        player.ammo = Math.min(player.maxAmmo, player.ammo + pickup.amount);
      } else {
        player.shield = Math.min(player.maxShield, player.shield + pickup.amount);
      }
      events.push({ type: 'PickupCollected', pickupId: pickup.id, kind: pickup.kind, amount: pickup.amount });
      break;
    }
  }
}

function handlePlayerWeapons(state: GameState, player: TankState, cmd: Command, levelCfg: LevelConfig, events: SimEvent[]): void {
  if (player.fireCooldown > 0) player.fireCooldown--;
  if (player.grenadeCooldown > 0) player.grenadeCooldown--;

  if (cmd.fire && player.fireCooldown <= 0 && player.ammo >= AMMO_PER_SHOT) {
    player.ammo -= AMMO_PER_SHOT;
    player.fireCooldown = PLAYER_FIRE_COOLDOWN_TICKS;
    fireProjectile(state, player, player.heading, events);
  }

  if (cmd.grenade && levelCfg.grenadesUnlocked && player.grenadeCooldown <= 0 && player.ammo >= GRENADE_AMMO_COST) {
    player.ammo -= GRENADE_AMMO_COST;
    player.grenadeCooldown = GRENADE_COOLDOWN_TICKS;
    fireGrenade(state, player, player.heading, events);
  }
}

function respawnEnemy(state: GameState, enemy: EnemyState, levelCfg: LevelConfig, events: SimEvent[]): void {
  const spawn: Vec2 = pickEdgeSpawnPoint(state);
  enemy.position = { ...spawn };
  enemy.prevPosition = { ...spawn };
  enemy.heading = 0;
  enemy.prevHeading = 0;
  enemy.speed = 0;
  const shield = levelCfg.enemyBaseShield + (enemy.kind === 'hunter' ? HUNTER_SHIELD_BONUS : 0);
  enemy.shield = shield;
  enemy.maxShield = shield;
  enemy.alive = true;
  enemy.aiState = 'PURSUE';
  enemy.stuckTicks = 0;
  enemy.unstickTicksRemaining = 0;
  enemy.fireCooldown = 0;
  events.push({ type: 'EnemyRespawned', enemyId: enemy.id, position: spawn });
}

// Marks an enemy dead, arms its respawn timer, and emits EnemyDestroyed.
// Scoring is the caller's decision — real combat kills score, debug kills
// (killAllEnemies) should not.
function markEnemyDestroyed(enemy: EnemyState, respawnTicks: number, events: SimEvent[]): void {
  enemy.alive = false;
  enemy.respawnTicksRemaining = respawnTicks;
  events.push({ type: 'EnemyDestroyed', enemyId: enemy.id, position: { ...enemy.position } });
}

function destroyEnemy(state: GameState, enemy: EnemyState, respawnTicks: number, events: SimEvent[]): void {
  markEnemyDestroyed(enemy, respawnTicks, events);
  state.score += SCORE_ENEMY_KILL;
}

// Checks for enemies whose shield was just depleted by weapons this tick and
// tanks respawn timers for already-dead enemies.
function handleEnemyLifecycle(state: GameState, levelCfg: LevelConfig, events: SimEvent[], respawnTicks: number): void {
  for (const enemy of state.enemies) {
    if (enemy.alive) {
      if (enemy.shield <= 0) destroyEnemy(state, enemy, respawnTicks, events);
      continue;
    }
    if (enemy.respawnTicksRemaining > 0) {
      enemy.respawnTicksRemaining--;
      if (enemy.respawnTicksRemaining <= 0) respawnEnemy(state, enemy, levelCfg, events);
    }
  }
}

function respawnPlayerAtSpawn(state: GameState, player: PlayerState, invulnTicks: number): void {
  applySpawn(player, spawnForSlot(player.slot, state.mode));
  player.alive = true;
  player.shield = player.maxShield;
  player.invulnerableTicks = invulnTicks;
}

// Solo (unchanged) and co-op lifecycle: a player's own lives count decides
// what happens on death. Co-op: each player has an independent lives pool;
// hitting 0 leaves that player dead until the level clears (resetPlayerForLevel
// revives them then, regardless of remaining lives) rather than ending the
// run — the run only ends once every present player's lives are exhausted.
function handleSoloCoopPlayer(state: GameState, player: PlayerState, events: SimEvent[]): void {
  if (player.invulnerableTicks > 0) player.invulnerableTicks--;
  if (!player.alive) return;
  if (state.god && player.slot === 0) return;
  if (player.shield > 0) return;

  const deathPosition = { ...player.position };
  player.lives--;
  events.push({ type: 'PlayerDestroyed', tankId: player.id, position: deathPosition, livesRemaining: player.lives });

  if (player.lives <= 0) {
    player.alive = false;
    if (state.players.every((p) => p.lives <= 0)) {
      state.gameOver = true;
      events.push({ type: 'GameOver', finalScore: state.score, finalLevel: state.level });
    }
    return;
  }

  respawnPlayerAtSpawn(state, player, PLAYER_RESPAWN_INVULN_TICKS);
  events.push({ type: 'PlayerRespawned', tankId: player.id });
}

// Duel lifecycle: death always respawns (on a timer, like an enemy) rather
// than costing a life; the match instead ends when one side's kill tally
// reaches DUEL_KILL_TARGET. Kill credit goes to whichever tank's shot/grenade
// last damaged the victim (TankState.lastHitBy).
function handleDuelPlayer(state: GameState, player: PlayerState, events: SimEvent[]): void {
  if (player.invulnerableTicks > 0) player.invulnerableTicks--;

  if (player.alive) {
    if (state.god && player.slot === 0) return;
    if (player.shield > 0) return;

    const deathPosition = { ...player.position };
    player.alive = false;
    player.respawnTicksRemaining = DUEL_RESPAWN_TICKS;
    events.push({ type: 'PlayerDestroyed', tankId: player.id, position: deathPosition, livesRemaining: 0 });

    const killerId = player.lastHitBy;
    player.lastHitBy = null;
    const killer = killerId ? state.players.find((p) => p.id === killerId) : undefined;
    if (killer) {
      killer.kills++;
      // Guard against a same-tick double win: if two players' final shots
      // land in the same tick, players are processed in slot order (see
      // handlePlayerLifecycle below) — the first winner found must stick,
      // not get overwritten by a later slot's processing in the same tick.
      if (!state.gameOver && killer.kills >= DUEL_KILL_TARGET) {
        state.gameOver = true;
        state.winner = killer.id;
        events.push({ type: 'GameOver', finalScore: state.score, finalLevel: state.level, winnerId: killer.id });
      }
    }
    return;
  }

  if (player.respawnTicksRemaining > 0) {
    player.respawnTicksRemaining--;
    if (player.respawnTicksRemaining <= 0) {
      respawnPlayerAtSpawn(state, player, DUEL_RESPAWN_INVULN_TICKS);
      events.push({ type: 'PlayerRespawned', tankId: player.id });
    }
  }
}

function handlePlayerLifecycle(state: GameState, events: SimEvent[]): void {
  const handler = state.mode === 'duel' ? handleDuelPlayer : handleSoloCoopPlayer;
  for (const player of state.players) handler(state, player, events);
}

// --- Debug-only helpers (used by game/debug.ts) ---

export function spawnEnemyAt(state: GameState, x: number, z: number, kind: 'drone' | 'hunter'): void {
  const cfg = levelConfig(state.level);
  state.enemies.push(createEnemy({ x, z }, kind, cfg, nextId(state, 'enemy')));
}

export function killAllEnemies(state: GameState): void {
  const events: SimEvent[] = [...state.events];
  for (const enemy of state.enemies) {
    if (enemy.alive) markEnemyDestroyed(enemy, ENEMY_RESPAWN_TICKS, events); // no score — debug-only kill
  }
  state.events = events;
}

// Advances the simulation by exactly one fixed tick. Deterministic given
// (state, commands) — the future multiplayer contract. `commands` is keyed
// by tank id, so any player beyond the first is just another entry (see
// input/keyboard.ts / game/app.ts).
export function step(state: GameState, commands: Record<string, Command>): void {
  if (state.gameOver) {
    state.events = [];
    return;
  }

  const events: SimEvent[] = [];
  const levelCfg = levelConfig(state.level);

  for (const player of state.players) {
    if (!player.alive) continue;
    const cmd = commands[player.id] ?? NEUTRAL_COMMAND;
    applyMovement(player, cmd, player.movement);
    resolveObstacleCollisionsFor(player, state, TANK_RADIUS, events, true);
    resolveArenaBoundsFor(player, TANK_RADIUS, events, true);
    handlePlayerWeapons(state, player, cmd, levelCfg, events);
  }

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const decision = enemyCommand(enemy, state, levelCfg);
    const moveParams = movementParamsForEnemy(enemy.kind, levelCfg);
    applyMovement(enemy, decision.command, moveParams);
    resolveObstacleCollisionsFor(enemy, state, ENEMY_TANK_RADIUS, events, false);
    resolveArenaBoundsFor(enemy, ENEMY_TANK_RADIUS, events, false);
    updateStuckDetection(enemy, decision.command.thrust, state);
    if (decision.command.fire) {
      fireProjectile(state, enemy, decision.fireHeading, events);
    }
  }

  // Weapons hit-test tank positions BEFORE tank-vs-tank push-out runs. Every
  // shot fired above used its owner's position as of that per-tank block —
  // if push-out ran first, a violent multi-tank pile-up (e.g. several tanks
  // stacked at a wall) can catapult a target several units in this same
  // tick, well past a projectile's short first-tick travel, so a shot that
  // was genuinely aimed at its target could whiff simply because the target
  // teleported away before hit-testing ran. Resolving weapons against the
  // same position snapshot that fired them eliminates that gap; push-out is
  // purely a physical solidity correction and doesn't need to happen before
  // combat is resolved for the tick.
  updateProjectiles(state, events);
  updateGrenades(state, events);
  resolveTankVsTankCollisions(state);
  resolveFinalStaticPass(state);
  advanceWindmills(state);
  handleEnemyLifecycle(state, levelCfg, events, ENEMY_RESPAWN_TICKS);
  handlePlayerLifecycle(state, events);
  resolveFlags(state, events);
  resolvePickups(state, events);

  if (state.tick % BONUS_DECAY_INTERVAL_TICKS === 0) {
    state.bonusRemaining = Math.max(0, state.bonusRemaining - 1);
  }

  state.events = events;
  state.tick++;
}
