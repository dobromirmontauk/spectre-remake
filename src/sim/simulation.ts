import type { EnemyState, GameMode, GameState, Loadout, TankState, Vec2 } from './types.ts';
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
import { fireGrenade, fireProjectile, updateGrenades, updateProjectiles } from './weapons.ts';
import { levelConfig, type LevelConfig } from '../config/levels.ts';
import {
  AMMO_PER_SHOT,
  ARENA_HALF_SIZE,
  BONUS_DECAY_INTERVAL_TICKS,
  BONUS_START,
  DEFAULT_LOADOUT,
  DUEL_KILL_TARGET,
  DUEL_RESPAWN_INVULN_TICKS,
  DUEL_RESPAWN_TICKS,
  DUEL_SPAWN_EDGE_MARGIN,
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
} from '../config/constants.ts';

function createPlayer(id: string, loadout: Loadout): TankState {
  return {
    id,
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
  };
}

// Where a player tank appears at the start of a level (solo/coop) or after a
// duel respawn. 'player' always spawns at arena center in solo/coop (matches
// the original, untouched); 'player2' spawns a short hop away in coop so the
// two tanks don't start stacked. Duel spawns both tanks at opposite arena
// edges, facing each other, since there's no shared "level start" to share.
const COOP_SPAWN_OFFSET = 5; // > 2*TANK_RADIUS so the two tanks don't spawn overlapping and shove each other apart on tick 1

function spawnForTank(tankId: string, mode: GameMode): { position: Vec2; heading: number } {
  if (mode === 'duel') {
    const edge = ARENA_HALF_SIZE - DUEL_SPAWN_EDGE_MARGIN;
    return tankId === 'player' ? { position: { x: 0, z: -edge }, heading: 0 } : { position: { x: 0, z: edge }, heading: Math.PI };
  }
  if (tankId === 'player2') return { position: { x: COOP_SPAWN_OFFSET, z: 0 }, heading: 0 };
  return { position: { x: 0, z: 0 }, heading: 0 };
}

function applySpawn(tank: TankState, spawn: { position: Vec2; heading: number }): void {
  tank.position = { ...spawn.position };
  tank.prevPosition = { ...spawn.position };
  tank.heading = spawn.heading;
  tank.prevHeading = spawn.heading;
  tank.speed = 0;
}

// Every alive human-controlled tank this tick — the shared collection point
// for AI targeting (nearest alive player) and co-op flag/pickup pickup.
export function alivePlayers(state: GameState): TankState[] {
  const players: TankState[] = [];
  if (state.player.alive) players.push(state.player);
  if (state.player2 && state.player2.alive) players.push(state.player2);
  return players;
}

function enemySeedFor(level: number): number {
  return (LEVELGEN_SEED_BASE ^ hashLevel(level) ^ ENEMY_SEED_SALT) >>> 0;
}

// Duel has no AI combatants at all; solo/coop use the usual level roster.
function buildEnemies(level: number, mode: GameMode): EnemyState[] {
  if (mode === 'duel') return [];
  const cfg = levelConfig(level);
  return buildEnemyRoster(enemySeedFor(level), cfg).map((spec) => createEnemy(spec.position, spec.kind, cfg));
}

// Duel has no flags (kill-count decides the match, not a level clear) —
// obstacles/pickups still populate so there's cover and restocks to fight over.
function layoutForMode(level: number, mode: GameMode): LevelLayout {
  const layout = buildLevel(level);
  if (mode === 'duel') return { ...layout, flags: [] };
  return layout;
}

export function createInitialState(
  level: number,
  loadout: Loadout = DEFAULT_LOADOUT,
  mode: GameMode = 'solo',
  loadout2: Loadout = DEFAULT_LOADOUT,
): GameState {
  const layout = layoutForMode(level, mode);
  const player = createPlayer('player', loadout);
  applySpawn(player, spawnForTank('player', mode));

  const player2 = mode === 'solo' ? null : createPlayer('player2', loadout2);
  if (player2) applySpawn(player2, spawnForTank('player2', mode));

  return {
    tick: 0,
    level,
    rng: createRng(LEVELGEN_SEED_BASE ^ level),
    mode,
    loadout,
    playerMovement: deriveMovementParams(loadout),
    player,
    loadout2,
    player2Movement: deriveMovementParams(loadout2),
    player2,
    obstacles: layout.obstacles,
    flags: layout.flags,
    pickups: layout.pickups,
    flagsCollected: 0,
    enemies: buildEnemies(level, mode),
    projectiles: [],
    grenades: [],
    lives: PLAYER_LIVES_START,
    lives2: PLAYER_LIVES_START,
    score: 0,
    bonusRemaining: BONUS_START,
    kills: { player: 0, player2: 0 },
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
function resetPlayerForLevel(state: GameState, player: TankState): void {
  applySpawn(player, spawnForTank(player.id, state.mode));
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
// resetGame()/resetGameWithLoadout() clears those.
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

  resetPlayerForLevel(state, state.player);
  if (state.player2) resetPlayerForLevel(state, state.player2);
}

// Full reset to a fresh game with the current loadout/mode — used by the
// debug `restart` hook (bypasses the menu/tank-setup flow for deterministic
// tests).
export function resetGame(state: GameState): void {
  state.tick = 0;
  state.lives = PLAYER_LIVES_START;
  state.lives2 = PLAYER_LIVES_START;
  state.score = 0;
  state.kills = { player: 0, player2: 0 };
  state.winner = null;
  state.gameOver = false;
  rebuildLevel(state, 1);
}

// Full reset to a fresh game with a newly-chosen loadout (and, for 2P modes,
// a mode + player2 loadout) — used by the tank-setup screen's "Start" button
// (see game/flow.ts / debug `startGame`). Omitting `opts` reproduces the
// original 1-player-only behavior exactly.
export function resetGameWithLoadout(
  state: GameState,
  loadout: Loadout,
  level = 1,
  opts: { mode?: GameMode; loadout2?: Loadout } = {},
): void {
  const mode = opts.mode ?? 'solo';
  state.mode = mode;
  state.loadout = loadout;
  state.playerMovement = deriveMovementParams(loadout);
  state.player.maxShield = loadout.shields;
  state.player.maxAmmo = loadout.ammo;

  if (mode === 'solo') {
    state.player2 = null;
  } else {
    const loadout2 = opts.loadout2 ?? DEFAULT_LOADOUT;
    state.loadout2 = loadout2;
    state.player2Movement = deriveMovementParams(loadout2);
    if (!state.player2) state.player2 = createPlayer('player2', loadout2);
    state.player2.maxShield = loadout2.shields;
    state.player2.maxAmmo = loadout2.ammo;
  }

  state.tick = 0;
  state.lives = PLAYER_LIVES_START;
  state.lives2 = PLAYER_LIVES_START;
  state.score = 0;
  state.kills = { player: 0, player2: 0 };
  state.winner = null;
  state.gameOver = false;
  rebuildLevel(state, level); // refills shield/ammo to the new maxes (REFILL_ON_LEVEL_START)
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
  const tanks: TankState[] = [state.player, ...(state.player2 ? [state.player2] : []), ...state.enemies].filter((t) => t.alive);
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
  for (const player of [state.player, state.player2]) {
    if (!player || !player.alive) continue;
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
// either alive player can collect one and both count toward the same total.
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

function respawnPlayerAtSpawn(state: GameState, player: TankState, invulnTicks: number): void {
  applySpawn(player, spawnForTank(player.id, state.mode));
  player.alive = true;
  player.shield = player.maxShield;
  player.invulnerableTicks = invulnTicks;
}

// Solo (unchanged) and co-op lifecycle: a player's own lives count decides
// what happens on death. Co-op: each player has an independent lives pool;
// hitting 0 leaves that player dead until the level clears (resetPlayerForLevel
// revives them then, regardless of remaining lives) rather than ending the
// run — the run only ends once every player's lives are exhausted.
function handleSoloCoopPlayer(state: GameState, player: TankState, livesKey: 'lives' | 'lives2', events: SimEvent[]): void {
  if (player.invulnerableTicks > 0) player.invulnerableTicks--;
  if (!player.alive) return;
  if (state.god && player.id === 'player') return;
  if (player.shield > 0) return;

  const deathPosition = { ...player.position };
  state[livesKey]--;
  events.push({ type: 'PlayerDestroyed', tankId: player.id, position: deathPosition, livesRemaining: state[livesKey] });

  if (state[livesKey] <= 0) {
    player.alive = false;
    const otherLives = player.id === 'player' ? state.lives2 : state.lives;
    const bothOut = !state.player2 || otherLives <= 0;
    if (bothOut) {
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
function handleDuelPlayer(state: GameState, player: TankState, events: SimEvent[]): void {
  if (player.invulnerableTicks > 0) player.invulnerableTicks--;

  if (player.alive) {
    if (state.god && player.id === 'player') return;
    if (player.shield > 0) return;

    const deathPosition = { ...player.position };
    player.alive = false;
    player.respawnTicksRemaining = DUEL_RESPAWN_TICKS;
    events.push({ type: 'PlayerDestroyed', tankId: player.id, position: deathPosition, livesRemaining: 0 });

    const killerId = player.lastHitBy;
    player.lastHitBy = null;
    const killerKey = killerId === 'player' ? 'player' : killerId === 'player2' ? 'player2' : null;
    if (killerKey) {
      state.kills[killerKey]++;
      // Guard against a same-tick double win: if both players' final shots
      // land in the same tick (each hits the other's last point simultaneously),
      // state.player is processed first — its win must stick, not get
      // overwritten by state.player2's processing right after.
      if (!state.gameOver && state.kills[killerKey] >= DUEL_KILL_TARGET) {
        state.gameOver = true;
        state.winner = killerKey;
        events.push({ type: 'GameOver', finalScore: state.score, finalLevel: state.level, winnerId: killerKey });
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
  if (state.mode === 'duel') {
    handleDuelPlayer(state, state.player, events);
    if (state.player2) handleDuelPlayer(state, state.player2, events);
    return;
  }
  handleSoloCoopPlayer(state, state.player, 'lives', events);
  if (state.player2) handleSoloCoopPlayer(state, state.player2, 'lives2', events);
}

// --- Debug-only helpers (used by game/debug.ts) ---

export function spawnEnemyAt(state: GameState, x: number, z: number, kind: 'drone' | 'hunter'): void {
  const cfg = levelConfig(state.level);
  state.enemies.push(createEnemy({ x, z }, kind, cfg));
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
// by tank id, so a second human player is just another entry (see
// input/keyboard.ts / game/app.ts).
export function step(state: GameState, commands: Record<string, Command>): void {
  if (state.gameOver) {
    state.events = [];
    return;
  }

  const events: SimEvent[] = [];
  const levelCfg = levelConfig(state.level);

  for (const player of [state.player, state.player2]) {
    if (!player || !player.alive) continue;
    const cmd = commands[player.id] ?? NEUTRAL_COMMAND;
    const movement = player.id === 'player2' ? state.player2Movement : state.playerMovement;
    applyMovement(player, cmd, movement);
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
