// Enemy tank FSM. No pathfinding (faithful to the original): PURSUE
// (turn-rate-limited pursuit + thrust naturally produces orbiting swarms),
// FIRE (aim-cone + range + cooldown, transient flavor state set the tick a
// shot is fired), UNSTICK (reverse-and-turn when wedged against geometry).
// Enemies produce the same Command type as the player and go through the
// same applyMovement()/collision path — just with their own MovementParams.

import type { EnemyKind, EnemyState, GameState, Vec2 } from './types.ts';
import type { Command } from './commands.ts';
import type { MovementParams } from './movement.ts';
import type { LevelConfig } from '../config/levels.ts';
import { createRng } from './rng.ts';
import {
  ARENA_HALF_SIZE,
  ENEMY_AIM_CONE_RAD,
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
  return Math.atan2(to.x - from.x, to.z - from.z);
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

let idCounter = 0;
function nextEnemyId(): string {
  return `enemy-${idCounter++}`;
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

export function createEnemy(position: Vec2, kind: EnemyKind, levelCfg: LevelConfig): EnemyState {
  const shield = shieldForKind(kind, levelCfg);
  return {
    id: nextEnemyId(),
    position: { ...position },
    prevPosition: { ...position },
    heading: 0,
    prevHeading: 0,
    speed: 0,
    shield,
    maxShield: shield,
    ammo: Infinity,
    maxAmmo: Infinity,
    alive: true,
    fireCooldown: 0,
    grenadeCooldown: 0,
    kind,
    aiState: 'PURSUE',
    stuckTicks: 0,
    unstickTicksRemaining: 0,
    unstickTurnDir: 1,
    respawnTicksRemaining: 0,
  };
}

// Random point on/near the arena edge, at least ENEMY_MIN_SPAWN_DIST_FROM_PLAYER
// from the player — used both for initial level population and respawns.
export function pickEdgeSpawnPoint(state: GameState): Vec2 {
  for (let attempt = 0; attempt < 30; attempt++) {
    const side = Math.floor(state.rng.next() * 4);
    const along = (state.rng.next() * 2 - 1) * (ARENA_HALF_SIZE - EDGE_SPAWN_MARGIN);
    const point = edgePoint(side, along);

    const dx = point.x - state.player.position.x;
    const dz = point.z - state.player.position.z;
    if (dx * dx + dz * dz >= ENEMY_MIN_SPAWN_DIST_FROM_PLAYER * ENEMY_MIN_SPAWN_DIST_FROM_PLAYER) {
      return point;
    }
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

export function enemyCommand(enemy: EnemyState, state: GameState, levelCfg: LevelConfig): EnemyDecision {
  if (enemy.fireCooldown > 0) enemy.fireCooldown--;

  if (enemy.unstickTicksRemaining > 0) {
    enemy.aiState = 'UNSTICK';
    enemy.unstickTicksRemaining--;
    if (enemy.unstickTicksRemaining <= 0) enemy.stuckTicks = 0;
    return { command: { turn: enemy.unstickTurnDir, thrust: -1, fire: false, grenade: false }, fireHeading: enemy.heading };
  }

  const player = state.player;
  const dx = player.position.x - enemy.position.x;
  const dz = player.position.z - enemy.position.z;
  const distance = Math.hypot(dx, dz);

  const isHunter = enemy.kind === 'hunter';
  let aimTarget: Vec2 = player.position;
  if (isHunter && distance > 1e-3) {
    const leadTime = (distance / PROJECTILE_SPEED) * HUNTER_LEAD_TIME_SCALE;
    aimTarget = {
      x: player.position.x + Math.sin(player.heading) * player.speed * leadTime,
      z: player.position.z + Math.cos(player.heading) * player.speed * leadTime,
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
  const displacement = Math.hypot(dx, dz);

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
