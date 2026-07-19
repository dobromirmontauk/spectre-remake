// Cannon shells + grenades: ammo-limited, cooldown-gated firing and swept
// collision against tanks/obstacles/arena bounds (prevents tunneling).

import type { GameState, TankState, Vec2 } from './types.ts';
import type { SimEvent } from './events.ts';
import { segmentVsAABB, segmentVsCircle } from './collision.ts';
import {
  ARENA_HALF_SIZE,
  ENEMY_DAMAGE_PER_SHOT,
  GRENADE_BLAST_RADIUS,
  GRENADE_DAMAGE,
  GRENADE_SPEED,
  GRENADE_FUSE_TICKS,
  PLAYER_DAMAGE_PER_SHOT,
  PROJECTILE_MAX_TICKS,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  SIM_DT,
  TANK_RADIUS,
} from '../config/constants.ts';

function nextId(state: GameState, prefix: string): string {
  return `${prefix}-${state.nextEntityId++}`;
}

// Spawns a shot from the tank's nose (half a tank-length ahead of center) so
// it doesn't immediately register as originating inside the firer.
function noseOf(tank: TankState, aheadDistance: number): Vec2 {
  return {
    x: tank.position.x + Math.sin(tank.heading) * aheadDistance,
    z: tank.position.z + Math.cos(tank.heading) * aheadDistance,
  };
}

export function fireProjectile(state: GameState, owner: TankState, heading: number, events: SimEvent[]): void {
  const position = noseOf(owner, TANK_RADIUS + 0.5);
  state.projectiles.push({
    id: nextId(state, 'shot'),
    ownerId: owner.id,
    position,
    prevPosition: { ...position },
    heading,
    speed: PROJECTILE_SPEED,
    ticksRemaining: PROJECTILE_MAX_TICKS,
  });
  events.push({ type: 'ShotFired', ownerId: owner.id, position, heading });
}

export function fireGrenade(state: GameState, owner: TankState, heading: number, events: SimEvent[]): void {
  const position = noseOf(owner, TANK_RADIUS + 0.5);
  state.grenades.push({
    id: nextId(state, 'grenade'),
    ownerId: owner.id,
    position,
    prevPosition: { ...position },
    heading,
    speed: GRENADE_SPEED,
    fuseTicksRemaining: GRENADE_FUSE_TICKS,
  });
  events.push({ type: 'GrenadeFired', ownerId: owner.id, position, heading });
}

function allTanks(state: GameState): TankState[] {
  return [state.player, ...(state.player2 ? [state.player2] : []), ...state.enemies];
}

function isPlayerTankId(id: string): boolean {
  return id === 'player' || id === 'player2';
}

function damageTank(state: GameState, target: TankState, shooterId: string, isPlayerTarget: boolean): void {
  if (isPlayerTarget) {
    if ((state.god && target.id === 'player') || target.invulnerableTicks > 0) return;
    target.shield -= PLAYER_DAMAGE_PER_SHOT;
  } else {
    target.shield -= ENEMY_DAMAGE_PER_SHOT;
  }
  target.lastHitBy = shooterId;
}

function outOfBounds(p: Vec2): boolean {
  return Math.abs(p.x) > ARENA_HALF_SIZE || Math.abs(p.z) > ARENA_HALF_SIZE;
}

export function updateProjectiles(state: GameState, events: SimEvent[]): void {
  const remaining: typeof state.projectiles = [];

  for (const shot of state.projectiles) {
    shot.prevPosition = { ...shot.position };
    shot.position = {
      x: shot.position.x + Math.sin(shot.heading) * shot.speed * SIM_DT,
      z: shot.position.z + Math.cos(shot.heading) * shot.speed * SIM_DT,
    };
    shot.ticksRemaining--;

    let consumed = false;

    for (const target of allTanks(state)) {
      if (target.id === shot.ownerId || !target.alive) continue;
      // Co-op has no friendly fire: a shot from one player passes straight
      // through the other rather than registering a hit.
      if (state.mode === 'coop' && isPlayerTankId(target.id) && isPlayerTankId(shot.ownerId)) continue;
      const hit = segmentVsCircle(shot.prevPosition, shot.position, target.position, TANK_RADIUS + PROJECTILE_RADIUS);
      if (!hit.hit) continue;
      const isPlayerTarget = isPlayerTankId(target.id);
      damageTank(state, target, shot.ownerId, isPlayerTarget);
      events.push({ type: 'ShotHit', position: hit.point, targetKind: isPlayerTarget ? 'player' : 'enemy' });
      consumed = true;
      break;
    }

    if (!consumed) {
      for (const obstacle of state.obstacles) {
        const hit =
          obstacle.kind === 'wall'
            ? segmentVsAABB(shot.prevPosition, shot.position, obstacle.min, obstacle.max)
            : segmentVsCircle(shot.prevPosition, shot.position, obstacle.position, obstacle.pylonRadius);
        if (!hit.hit) continue;
        events.push({ type: 'ShotHit', position: hit.point, targetKind: 'obstacle' });
        consumed = true;
        break;
      }
    }

    if (!consumed && outOfBounds(shot.position)) {
      events.push({ type: 'ShotHit', position: shot.position, targetKind: 'bounds' });
      consumed = true;
    }

    if (!consumed && shot.ticksRemaining > 0) {
      remaining.push(shot);
    }
    // Silent range expiry (ticksRemaining hit 0 without impact) — no event.
  }

  state.projectiles = remaining;
}

function explodeGrenade(state: GameState, position: Vec2, events: SimEvent[]): void {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.position.x - position.x;
    const dz = enemy.position.z - position.z;
    if (dx * dx + dz * dz <= GRENADE_BLAST_RADIUS * GRENADE_BLAST_RADIUS) {
      enemy.shield -= GRENADE_DAMAGE;
    }
  }
  events.push({ type: 'GrenadeExploded', position, radius: GRENADE_BLAST_RADIUS });
}

export function updateGrenades(state: GameState, events: SimEvent[]): void {
  const remaining: typeof state.grenades = [];

  for (const grenade of state.grenades) {
    grenade.prevPosition = { ...grenade.position };
    grenade.position = {
      x: grenade.position.x + Math.sin(grenade.heading) * grenade.speed * SIM_DT,
      z: grenade.position.z + Math.cos(grenade.heading) * grenade.speed * SIM_DT,
    };
    grenade.fuseTicksRemaining--;

    let exploded = false;

    // Detonate on contact with any enemy tank — without this a fast-flying
    // grenade would sail straight through a cluster it's aimed at and only
    // go off on the far wall or fuse timeout, which defeats the point of an
    // area weapon aimed at nearby enemies.
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      const hit = segmentVsCircle(grenade.prevPosition, grenade.position, enemy.position, TANK_RADIUS);
      if (!hit.hit) continue;
      explodeGrenade(state, hit.point, events);
      exploded = true;
      break;
    }

    if (!exploded) {
      for (const obstacle of state.obstacles) {
        const hit =
          obstacle.kind === 'wall'
            ? segmentVsAABB(grenade.prevPosition, grenade.position, obstacle.min, obstacle.max)
            : segmentVsCircle(grenade.prevPosition, grenade.position, obstacle.position, obstacle.pylonRadius);
        if (!hit.hit) continue;
        explodeGrenade(state, hit.point, events);
        exploded = true;
        break;
      }
    }

    if (!exploded && outOfBounds(grenade.position)) {
      explodeGrenade(state, grenade.position, events);
      exploded = true;
    }

    if (!exploded && grenade.fuseTicksRemaining <= 0) {
      explodeGrenade(state, grenade.position, events);
      exploded = true;
    }

    if (!exploded) remaining.push(grenade);
  }

  state.grenades = remaining;
}
