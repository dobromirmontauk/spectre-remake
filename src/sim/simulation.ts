import type { EnemyState, GameState, Loadout, TankState, Vec2 } from './types.ts';
import type { Command } from './commands.ts';
import { NEUTRAL_COMMAND } from './commands.ts';
import type { SimEvent } from './events.ts';
import { applyMovement, deriveMovementParams } from './movement.ts';
import { circleVsAABB, circleVsCircle, containInArena } from './collision.ts';
import { buildLevel, hashLevel } from './levelgen.ts';
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

function createPlayer(loadout: Loadout): TankState {
  return {
    id: 'player',
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
  };
}

function enemySeedFor(level: number): number {
  return (LEVELGEN_SEED_BASE ^ hashLevel(level) ^ ENEMY_SEED_SALT) >>> 0;
}

function buildEnemies(level: number): EnemyState[] {
  const cfg = levelConfig(level);
  return buildEnemyRoster(enemySeedFor(level), cfg).map((spec) => createEnemy(spec.position, spec.kind, cfg));
}

export function createInitialState(level: number, loadout: Loadout = DEFAULT_LOADOUT): GameState {
  const layout = buildLevel(level);
  return {
    tick: 0,
    level,
    rng: createRng(LEVELGEN_SEED_BASE ^ level),
    loadout,
    playerMovement: deriveMovementParams(loadout),
    player: createPlayer(loadout),
    obstacles: layout.obstacles,
    flags: layout.flags,
    pickups: layout.pickups,
    flagsCollected: 0,
    enemies: buildEnemies(level),
    projectiles: [],
    grenades: [],
    lives: PLAYER_LIVES_START,
    score: 0,
    bonusRemaining: BONUS_START,
    invulnerableTicks: 0,
    gameOver: false,
    god: false,
    nextEntityId: 0,
    events: [],
  };
}

// Rebuilds the arena for `level` in place, resetting the player to spawn and
// repopulating enemies. Called by game/flow.ts on LevelComplete, or directly
// by debug hooks. Lives/score/god persist across levels; only a full
// resetGame() clears those.
export function rebuildLevel(state: GameState, level: number): void {
  const layout = buildLevel(level);
  state.level = level;
  state.obstacles = layout.obstacles;
  state.flags = layout.flags;
  state.pickups = layout.pickups;
  state.flagsCollected = 0;
  state.enemies = buildEnemies(level);
  state.projectiles = [];
  state.grenades = [];
  state.bonusRemaining = BONUS_START;
  state.invulnerableTicks = 0;

  const player = state.player;
  player.position = { x: 0, z: 0 };
  player.prevPosition = { x: 0, z: 0 };
  player.heading = 0;
  player.prevHeading = 0;
  player.speed = 0;
  player.alive = true;
  player.fireCooldown = 0;
  player.grenadeCooldown = 0;
  if (REFILL_ON_LEVEL_START) {
    player.shield = player.maxShield;
    player.ammo = player.maxAmmo;
  }
}

// Full reset to a fresh game with the current loadout — used by the debug
// `restart` hook (bypasses the menu/tank-setup flow for deterministic tests).
export function resetGame(state: GameState): void {
  state.tick = 0;
  state.lives = PLAYER_LIVES_START;
  state.score = 0;
  state.gameOver = false;
  rebuildLevel(state, 1);
}

// Full reset to a fresh game with a newly-chosen loadout — used by the
// tank-setup screen's "Start" button (see game/flow.ts / debug `startGame`).
export function resetGameWithLoadout(state: GameState, loadout: Loadout, level = 1): void {
  state.loadout = loadout;
  state.playerMovement = deriveMovementParams(loadout);
  state.player.maxShield = loadout.shields;
  state.player.maxAmmo = loadout.ammo;
  state.tick = 0;
  state.lives = PLAYER_LIVES_START;
  state.score = 0;
  state.gameOver = false;
  rebuildLevel(state, level); // refills shield/ammo to the new maxes (REFILL_ON_LEVEL_START)
}

function resolveObstacleCollisionsFor(tank: TankState, state: GameState, radius: number, events: SimEvent[]): void {
  for (const obstacle of state.obstacles) {
    const hit =
      obstacle.kind === 'wall'
        ? circleVsAABB(tank.position, radius, obstacle.min, obstacle.max)
        : circleVsCircle(tank.position, radius, obstacle.position, obstacle.pylonRadius);

    if (!hit.hit) continue;

    tank.position.x += hit.normal.x * hit.penetration;
    tank.position.z += hit.normal.z * hit.penetration;
    if (WALL_STOPS_DEAD) tank.speed = 0;
    if (tank.id === state.player.id) events.push({ type: 'WallHit', obstacleId: obstacle.id });
  }
}

function resolveArenaBoundsFor(tank: TankState, radius: number, events: SimEvent[], isPlayer: boolean): void {
  const contained = containInArena(tank.position, radius, ARENA_HALF_SIZE);
  if (contained.hitWall) {
    tank.position.x = contained.x;
    tank.position.z = contained.z;
    if (WALL_STOPS_DEAD) tank.speed = 0;
    if (isPlayer) events.push({ type: 'WallHit', obstacleId: 'arena-bounds' });
  }
}

// Tanks are solid: mutual circle-vs-circle push-out for every alive pair
// (player-enemy and enemy-enemy), resolved after each tank's own
// obstacle/arena-bounds collision. Position-only (no speed change) — matches
// the plan's "tanks/flags/pickups = circles" 2D collision model.
function resolveTankVsTankCollisions(state: GameState): void {
  const tanks: TankState[] = [state.player, ...state.enemies].filter((t) => t.alive);
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
// respawn to arena center, enemy respawn to an edge point already well
// inside bounds).
function resolveFinalStaticPass(state: GameState): void {
  const discard: SimEvent[] = [];
  if (state.player.alive) {
    resolveObstacleCollisionsFor(state.player, state, TANK_RADIUS, discard);
    resolveArenaBoundsFor(state.player, TANK_RADIUS, discard, true);
  }
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    resolveObstacleCollisionsFor(enemy, state, ENEMY_TANK_RADIUS, discard);
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

function resolveFlags(state: GameState, events: SimEvent[]): void {
  for (const flag of state.flags) {
    if (flag.collected) continue;
    const hit = circleVsCircle(state.player.position, TANK_RADIUS, flag.position, FLAG_COLLECT_RADIUS);
    if (!hit.hit) continue;
    flag.collected = true;
    state.flagsCollected++;
    state.score += SCORE_FLAG;
    events.push({ type: 'FlagCollected', flagId: flag.id, flagsCollected: state.flagsCollected });
  }

  if (state.flagsCollected >= state.flags.length) {
    state.score += state.bonusRemaining;
    events.push({ type: 'LevelComplete', level: state.level });
  }
}

function resolvePickups(state: GameState, events: SimEvent[]): void {
  const player = state.player;
  for (const pickup of state.pickups) {
    if (pickup.collected) continue;
    const hit = circleVsCircle(player.position, TANK_RADIUS, pickup.position, PICKUP_COLLECT_RADIUS);
    if (!hit.hit) continue;

    pickup.collected = true;
    if (pickup.kind === 'ammo') {
      player.ammo = Math.min(player.maxAmmo, player.ammo + pickup.amount);
    } else {
      player.shield = Math.min(player.maxShield, player.shield + pickup.amount);
    }
    events.push({ type: 'PickupCollected', pickupId: pickup.id, kind: pickup.kind, amount: pickup.amount });
  }
}

function handlePlayerWeapons(state: GameState, cmd: Command, levelCfg: LevelConfig, events: SimEvent[]): void {
  const player = state.player;
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

function handlePlayerLifecycle(state: GameState, events: SimEvent[]): void {
  const player = state.player;
  if (state.invulnerableTicks > 0) state.invulnerableTicks--;
  if (!player.alive || state.god) return;
  if (player.shield > 0) return;

  const deathPosition = { ...player.position };
  state.lives--;
  events.push({ type: 'PlayerDestroyed', position: deathPosition, livesRemaining: state.lives });

  if (state.lives <= 0) {
    player.alive = false;
    state.gameOver = true;
    events.push({ type: 'GameOver', finalScore: state.score, finalLevel: state.level });
    return;
  }

  player.position = { x: 0, z: 0 };
  player.prevPosition = { x: 0, z: 0 };
  player.heading = 0;
  player.prevHeading = 0;
  player.speed = 0;
  player.shield = player.maxShield;
  state.invulnerableTicks = PLAYER_RESPAWN_INVULN_TICKS;
  events.push({ type: 'PlayerRespawned' });
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
// (state, commands) — the future multiplayer contract.
export function step(state: GameState, commands: Record<string, Command>): void {
  if (state.gameOver) {
    state.events = [];
    return;
  }

  const events: SimEvent[] = [];
  const levelCfg = levelConfig(state.level);
  const playerCommand = commands[state.player.id] ?? NEUTRAL_COMMAND;

  if (state.player.alive) {
    applyMovement(state.player, playerCommand, state.playerMovement);
    resolveObstacleCollisionsFor(state.player, state, TANK_RADIUS, events);
    resolveArenaBoundsFor(state.player, TANK_RADIUS, events, true);
    handlePlayerWeapons(state, playerCommand, levelCfg, events);
  }

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const decision = enemyCommand(enemy, state, levelCfg);
    const moveParams = movementParamsForEnemy(enemy.kind, levelCfg);
    applyMovement(enemy, decision.command, moveParams);
    resolveObstacleCollisionsFor(enemy, state, ENEMY_TANK_RADIUS, events);
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
