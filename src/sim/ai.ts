// Enemy tank FSM. No pathfinding (faithful to the original): PURSUE
// (turn-rate-limited pursuit + thrust naturally produces orbiting swarms),
// FIRE (aim-cone + range + cooldown, transient flavor state set the tick a
// shot is fired), UNSTICK (reverse-and-turn when wedged against geometry).
// Enemies produce the same Command type as the player and go through the
// same applyMovement()/collision path — just with their own MovementParams.

import type { EnemyKind, EnemyState, GameState, PlayerState, Vec2 } from './types.ts';
import type { Command } from './commands.ts';
import type { MovementParams } from './movement.ts';
import type { LevelConfig } from '../config/levels.ts';
import { createRng } from './rng.ts';
import { datan2, dcos, dlen, dsin } from './dmath.ts';
import {
  ARENA_HALF_SIZE,
  ENEMY_AIM_CONE_RAD,
  ENEMY_AMMO,
  ENEMY_COAST_FRICTION,
  ENEMY_FIRE_COOLDOWN_JITTER_TICKS,
  ENEMY_FIRE_RANGE,
  ENEMY_MAX_REVERSE_SPEED,
  ENEMY_MIN_SPAWN_DIST_FROM_PLAYER,
  ENEMY_REVERSE_ACCEL,
  ENEMY_THRUST_ACCEL,
  ENEMY_TURN_RATE,
  ENEMY_BASE_MAX_SPEED,
  HUNTER_BASE_MAX_SPEED,
  HUNTER_LEAD_TIME_SCALE,
  HUNTER_SHIELD_BONUS,
  PROJECTILE_SPEED,
  STUCK_DISPLACEMENT_EPSILON,
  STUCK_TICKS_THRESHOLD,
  UNSTICK_DURATION_TICKS,
} from '../config/constants.ts';

function angleTo(from: Vec2, to: Vec2): number {
  return datan2(to.x - from.x, to.z - from.z);
}

function normalizeAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

export function movementParamsForEnemy(kind: EnemyKind, levelCfg: LevelConfig): MovementParams {
  const baseMaxSpeed = kind === 'hunter' ? HUNTER_BASE_MAX_SPEED : ENEMY_BASE_MAX_SPEED;
  return {
    turnRate: ENEMY_TURN_RATE,
    thrustAccel: ENEMY_THRUST_ACCEL,
    reverseAccel: ENEMY_REVERSE_ACCEL,
    coastFriction: ENEMY_COAST_FRICTION,
    maxSpeed: baseMaxSpeed * levelCfg.enemySpeedMultiplier,
    maxReverseSpeed: ENEMY_MAX_REVERSE_SPEED,
  };
}

function shieldForKind(kind: EnemyKind, levelCfg: LevelConfig): number {
  return levelCfg.enemyBaseShield + (kind === 'hunter' ? HUNTER_SHIELD_BONUS : 0);
}

const EDGE_SPAWN_MARGIN = 6;

// One of the 4 arena edges, offset `along` its length — shared by the
// deterministic level roster and by seeded runtime respawns.
function edgePoint(side: number, along: number): Vec2 {
  const edge = ARENA_HALF_SIZE - EDGE_SPAWN_MARGIN;
  if (side === 0) return { x: along, z: edge };
  if (side === 1) return { x: along, z: -edge };
  if (side === 2) return { x: edge, z: along };
  return { x: -edge, z: along };
}

// `id` is supplied by the caller — simulation.ts's buildEnemies() assigns
// level-qualified roster ids (`enemy-L{level}-{i}`); debug/respawn spawns
// (simulation.ts spawnEnemyAt) draw from state.nextEntityId, exactly like
// projectiles/grenades (weapons.ts). A module-global counter used to do this
// instead, which made an enemy's id depend on how many enemies had ever
// existed in the session — not reconstructible from (state, commands) alone,
// which breaks both save/restore and cross-peer state hashing.
export function createEnemy(position: Vec2, kind: EnemyKind, levelCfg: LevelConfig, id: string): EnemyState {
  const shield = shieldForKind(kind, levelCfg);
  return {
    id,
    position: { ...position },
    prevPosition: { ...position },
    heading: 0,
    prevHeading: 0,
    speed: 0,
    shield,
    maxShield: shield,
    ammo: ENEMY_AMMO,
    maxAmmo: ENEMY_AMMO,
    alive: true,
    fireCooldown: 0,
    grenadeCooldown: 0,
    invulnerableTicks: 0,
    lastHitBy: null,
    respawnTicksRemaining: 0,
    kind,
    aiState: 'PURSUE',
    stuckTicks: 0,
    unstickTicksRemaining: 0,
    unstickTurnDir: 1,
  };
}

// True if `point` is far enough from every present player tank (all slots,
// not just slot 0) to be a fair enemy spawn.
function farEnoughFromPlayers(state: GameState, point: Vec2): boolean {
  for (const player of state.players) {
    const dx = point.x - player.position.x;
    const dz = point.z - player.position.z;
    if (dx * dx + dz * dz < ENEMY_MIN_SPAWN_DIST_FROM_PLAYER * ENEMY_MIN_SPAWN_DIST_FROM_PLAYER) return false;
  }
  return true;
}

// Random point on/near the arena edge, at least ENEMY_MIN_SPAWN_DIST_FROM_PLAYER
// from every player — used both for initial level population and respawns.
export function pickEdgeSpawnPoint(state: GameState): Vec2 {
  for (let attempt = 0; attempt < 30; attempt++) {
    const side = Math.floor(state.rng.next() * 4);
    const along = (state.rng.next() * 2 - 1) * (ARENA_HALF_SIZE - EDGE_SPAWN_MARGIN);
    const point = edgePoint(side, along);
    if (farEnoughFromPlayers(state, point)) return point;
  }
  // Fallback: arena corner, always far from a centrally-spawning player.
  return { x: ARENA_HALF_SIZE - EDGE_SPAWN_MARGIN, z: ARENA_HALF_SIZE - EDGE_SPAWN_MARGIN };
}

// Deterministic enemy roster for a level, seeded off the level number (mirrors
// levelgen.ts's approach so a level's enemy composition is reproducible).
export function buildEnemyRoster(levelSeed: number, levelCfg: LevelConfig): { position: Vec2; kind: EnemyKind }[] {
  const rng = createRng(levelSeed);
  const roster: { position: Vec2; kind: EnemyKind }[] = [];
  for (let i = 0; i < levelCfg.enemyCount; i++) {
    const side = Math.floor(rng.next() * 4);
    const along = (rng.next() * 2 - 1) * (ARENA_HALF_SIZE - EDGE_SPAWN_MARGIN);
    roster.push({ position: edgePoint(side, along), kind: i < levelCfg.hunterCount ? 'hunter' : 'drone' });
  }
  return roster;
}

// Produces this tick's Command for one enemy and advances its FSM bookkeeping
// (aiState/timers) in place. Movement/collision is applied by the caller
// (simulation.ts) exactly like the player's.
export interface EnemyDecision {
  command: Command;
  fireHeading: number; // angle to aim target; only meaningful when command.fire is true
}

// Closest alive player tank to `from` — the AI targeting rule for N-player
// co-op (enemies always go after whichever human is nearest); reduces to
// the lone solo player whenever there's only one, and iterates state.players
// in slot order so 1-2 player behavior (and rng consumption elsewhere) is
// unchanged from before this refactor.
function nearestAlivePlayer(state: GameState, from: Vec2): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDistSq = Infinity;
  for (const candidate of state.players) {
    if (!candidate.alive) continue;
    const dx = candidate.position.x - from.x;
    const dz = candidate.position.z - from.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = candidate;
    }
  }
  return best;
}

export function enemyCommand(enemy: EnemyState, state: GameState, levelCfg: LevelConfig): EnemyDecision {
  if (enemy.fireCooldown > 0) enemy.fireCooldown--;

  if (enemy.unstickTicksRemaining > 0) {
    enemy.aiState = 'UNSTICK';
    enemy.unstickTicksRemaining--;
    if (enemy.unstickTicksRemaining <= 0) enemy.stuckTicks = 0;
    return { command: { turn: enemy.unstickTurnDir, thrust: -1, fire: false, grenade: false }, fireHeading: enemy.heading };
  }

  const player = nearestAlivePlayer(state, enemy.position);
  if (!player) {
    // No alive player to pursue (both eliminated the same tick) — idle.
    return { command: { turn: 0, thrust: 0, fire: false, grenade: false }, fireHeading: enemy.heading };
  }
  const dx = player.position.x - enemy.position.x;
  const dz = player.position.z - enemy.position.z;
  const distance = dlen(dx, dz);

  const isHunter = enemy.kind === 'hunter';
  let aimTarget: Vec2 = player.position;
  if (isHunter && distance > 1e-3) {
    const leadTime = (distance / PROJECTILE_SPEED) * HUNTER_LEAD_TIME_SCALE;
    aimTarget = {
      x: player.position.x + dsin(player.heading) * player.speed * leadTime,
      z: player.position.z + dcos(player.heading) * player.speed * leadTime,
    };
  }

  const angleToPlayer = angleTo(enemy.position, player.position);
  const pursueTurnDiff = normalizeAngle(angleToPlayer - enemy.heading);
  const turn: -1 | 0 | 1 = pursueTurnDiff > 0.02 ? 1 : pursueTurnDiff < -0.02 ? -1 : 0;

  let fire = false;
  const angleToAim = angleTo(enemy.position, aimTarget);
  if (enemy.fireCooldown <= 0 && distance <= ENEMY_FIRE_RANGE) {
    const aimDiff = Math.abs(normalizeAngle(angleToAim - enemy.heading));
    if (aimDiff <= ENEMY_AIM_CONE_RAD) {
      fire = true;
      enemy.fireCooldown = levelCfg.enemyFireCooldownTicks + Math.floor(state.rng.next() * ENEMY_FIRE_COOLDOWN_JITTER_TICKS);
    }
  }

  enemy.aiState = fire ? 'FIRE' : 'PURSUE';
  return { command: { turn, thrust: 1, fire, grenade: false }, fireHeading: angleToAim };
}

// Called once per tick for every enemy after movement+collision has been
// resolved — detects "wedged against geometry" (thrusting but not actually
// displacing) and arms the UNSTICK state with a seeded turn direction.
export function updateStuckDetection(enemy: EnemyState, commandedThrust: number, state: GameState): void {
  if (enemy.unstickTicksRemaining > 0) return;

  const dx = enemy.position.x - enemy.prevPosition.x;
  const dz = enemy.position.z - enemy.prevPosition.z;
  const displacement = dlen(dx, dz);

  if (commandedThrust !== 0 && displacement < STUCK_DISPLACEMENT_EPSILON) {
    enemy.stuckTicks++;
  } else {
    enemy.stuckTicks = 0;
  }

  if (enemy.stuckTicks >= STUCK_TICKS_THRESHOLD) {
    enemy.unstickTicksRemaining = UNSTICK_DURATION_TICKS;
    enemy.unstickTurnDir = state.rng.next() < 0.5 ? -1 : 1;
    enemy.stuckTicks = 0;
  }
}
