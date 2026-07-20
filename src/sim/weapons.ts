// Cannon shells + grenades: ammo-limited, cooldown-gated firing and swept
// collision against tanks/obstacles/arena bounds (prevents tunneling).

import type { GameState, TankState, Vec2 } from './types.ts';
import type { SimEvent } from './events.ts';
import { segmentVsAABB, segmentVsCircle } from './collision.ts';
import { dcos, dsin } from './dmath.ts';
import {
  ARENA_HALF_SIZE,
  ENEMY_DAMAGE_PER_SHOT,
  GRENADE_BLAST_RADIUS,
  GRENADE_DAMAGE,
  GRENADE_DAMAGE_PLAYER,
  GRENADE_SPEED,
  GRENADE_FUSE_TICKS,
  PLAYER_DAMAGE_PER_SHOT,
  PROJECTILE_MAX_TICKS,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  SIM_DT,
  TANK_RADIUS,
} from '../config/constants.ts';

// Exported so simulation.ts's debug-only spawnEnemyAt can mint an id the
// same way projectiles/grenades do, keeping every runtime-created (as
// opposed to level-roster) entity on the single shared state.nextEntityId
// counter — see ai.ts createEnemy's doc comment for why that matters.
export function nextId(state: GameState, prefix: string): string {
  return `${prefix}-${state.nextEntityId++}`;
}

// Spawns a shot from the tank's nose (half a tank-length ahead of center) so
// it doesn't immediately register as originating inside the firer.
function noseOf(tank: TankState, aheadDistance: number): Vec2 {
  return {
    x: tank.position.x + dsin(tank.heading) * aheadDistance,
    z: tank.position.z + dcos(tank.heading) * aheadDistance,
  };
}

export function fireProjectile(state: GameState, owner: TankState, heading: number, events: SimEvent[]): void {
  // Collision starts at the owner's CENTER, not the nose. The nose offset
  // (TANK_RADIUS + 0.5 = 2.1) is larger than a shot's hit radius against a
  // tank (TANK_RADIUS + PROJECTILE_RADIUS = 1.9), so at point-blank — where
  // tank-vs-tank push-out hasn't separated the overlapping pair yet this tick
  // (see simulation.ts tick order) — a nose-spawned shot starts PAST the
  // target's far edge and its forward-only sweep never touches it: the "bullets
  // pass straight through at point-blank" bug. Center-spawning guarantees the
  // first swept segment (center -> center+travel) crosses any overlapping
  // target; the owner itself is excluded by id in updateProjectiles, and the
  // muzzle flash still reads from the nose via the ShotFired event below.
  const position = { x: owner.position.x, z: owner.position.z };
  state.projectiles.push({
    id: nextId(state, 'shot'),
    ownerId: owner.id,
    position,
    prevPosition: { ...position },
    heading,
    speed: PROJECTILE_SPEED,
    ticksRemaining: PROJECTILE_MAX_TICKS,
  });
  events.push({ type: 'ShotFired', ownerId: owner.id, position: noseOf(owner, TANK_RADIUS + 0.5), heading });
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
  return [...state.players, ...state.enemies];
}

function isPlayerTankId(state: GameState, id: string): boolean {
  return state.players.some((p) => p.id === id);
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
      x: shot.position.x + dsin(shot.heading) * shot.speed * SIM_DT,
      z: shot.position.z + dcos(shot.heading) * shot.speed * SIM_DT,
    };
    shot.ticksRemaining--;

    let consumed = false;

    for (const target of allTanks(state)) {
      if (target.id === shot.ownerId || !target.alive) continue;
      const isPlayerTarget = isPlayerTankId(state, target.id);
      const isPlayerOwner = isPlayerTankId(state, shot.ownerId);
      // Co-op has no friendly fire: a shot from one player passes straight
      // through the other rather than registering a hit.
      if (state.mode === 'coop' && isPlayerTarget && isPlayerOwner) continue;
      // Enemy-vs-enemy friendly fire is a match option (default on): when off,
      // an enemy's shot flies harmlessly through other enemies.
      if (!isPlayerTarget && !isPlayerOwner && !state.enemyFriendlyFire) continue;
      const hit = segmentVsCircle(shot.prevPosition, shot.position, target.position, TANK_RADIUS + PROJECTILE_RADIUS);
      if (!hit.hit) continue;
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

// Duel-only player damage (deferred from M1, plan Design §1: this loop used
// to only ever touch state.enemies — duel has none, so a duel grenade was
// dead code that could never hurt anything). Co-op/solo are untouched (guard
// on state.mode): co-op keeps its no-friendly-fire rule exactly like cannon
// shots (updateProjectiles above), and solo has no second player to hit.
// Same invuln/god-mode guard as a cannon hit; kill credit goes through
// lastHitBy exactly like updateProjectiles' damageTank, so a fatal blast
// still tallies a duel kill via handleDuelPlayer.
function damageDuelPlayers(state: GameState, position: Vec2, ownerId: string): void {
  for (const player of state.players) {
    if (!player.alive || player.id === ownerId) continue;
    if ((state.god && player.id === 'player') || player.invulnerableTicks > 0) continue;
    const dx = player.position.x - position.x;
    const dz = player.position.z - position.z;
    if (dx * dx + dz * dz <= GRENADE_BLAST_RADIUS * GRENADE_BLAST_RADIUS) {
      player.shield -= GRENADE_DAMAGE_PLAYER;
      player.lastHitBy = ownerId;
    }
  }
}

function explodeGrenade(state: GameState, position: Vec2, ownerId: string, events: SimEvent[]): void {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.position.x - position.x;
    const dz = enemy.position.z - position.z;
    if (dx * dx + dz * dz <= GRENADE_BLAST_RADIUS * GRENADE_BLAST_RADIUS) {
      enemy.shield -= GRENADE_DAMAGE;
    }
  }
  if (state.mode === 'duel') damageDuelPlayers(state, position, ownerId);
  events.push({ type: 'GrenadeExploded', position, radius: GRENADE_BLAST_RADIUS });
}

export function updateGrenades(state: GameState, events: SimEvent[]): void {
  const remaining: typeof state.grenades = [];

  for (const grenade of state.grenades) {
    grenade.prevPosition = { ...grenade.position };
    grenade.position = {
      x: grenade.position.x + dsin(grenade.heading) * grenade.speed * SIM_DT,
      z: grenade.position.z + dcos(grenade.heading) * grenade.speed * SIM_DT,
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
      explodeGrenade(state, hit.point, grenade.ownerId, events);
      exploded = true;
      break;
    }

    // Duel has no enemies (the loop above is a no-op there) — detonate on
    // contact with a non-owner opponent tank too, same as the enemy-contact
    // case above, so a direct hit goes off immediately instead of only ever
    // exploding on a wall/bounds/fuse timeout.
    if (!exploded && state.mode === 'duel') {
      for (const player of state.players) {
        if (!player.alive || player.id === grenade.ownerId) continue;
        const hit = segmentVsCircle(grenade.prevPosition, grenade.position, player.position, TANK_RADIUS);
        if (!hit.hit) continue;
        explodeGrenade(state, hit.point, grenade.ownerId, events);
        exploded = true;
        break;
      }
    }

    if (!exploded) {
      for (const obstacle of state.obstacles) {
        const hit =
          obstacle.kind === 'wall'
            ? segmentVsAABB(grenade.prevPosition, grenade.position, obstacle.min, obstacle.max)
            : segmentVsCircle(grenade.prevPosition, grenade.position, obstacle.position, obstacle.pylonRadius);
        if (!hit.hit) continue;
        explodeGrenade(state, hit.point, grenade.ownerId, events);
        exploded = true;
        break;
      }
    }

    if (!exploded && outOfBounds(grenade.position)) {
      explodeGrenade(state, grenade.position, grenade.ownerId, events);
      exploded = true;
    }

    if (!exploded && grenade.fuseTicksRemaining <= 0) {
      explodeGrenade(state, grenade.position, grenade.ownerId, events);
      exploded = true;
    }

    if (!exploded) remaining.push(grenade);
  }

  state.grenades = remaining;
}
