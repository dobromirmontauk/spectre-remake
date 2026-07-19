import type { Flag, Obstacle, Pickup, PickupKind, Vec2 } from './types.ts';
import { createRng } from './rng.ts';
import { dlen } from './dmath.ts';
import {
  ARENA_HALF_SIZE,
  EDGE_MARGIN,
  LEVELGEN_SEED_BASE,
  OBSTACLE_MIN_SEPARATION,
  PLAYER_SAFE_RADIUS,
  WALL_COUNT,
  WALL_MAX_SIZE,
  WALL_MIN_SIZE,
  WINDMILL_BLADE_LENGTH,
  WINDMILL_COUNT,
  WINDMILL_PYLON_RADIUS,
  FLAGS_PER_LEVEL,
  FLAG_COLLECT_RADIUS,
  AMMO_PICKUP_COUNT,
  SHIELD_PICKUP_COUNT,
  AMMO_PICKUP_AMOUNT,
  SHIELD_PICKUP_AMOUNT,
  PICKUP_COLLECT_RADIUS,
} from '../config/constants.ts';

export interface LevelLayout {
  obstacles: Obstacle[];
  flags: Flag[];
  pickups: Pickup[];
}

// Level number deterministically derives a seed so a level's layout is
// identical every run (and reproducible from the number alone, e.g. for
// networked clients later).
export function hashLevel(level: number): number {
  let h = (level ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

interface PlacedCircle {
  position: Vec2;
  radius: number;
}

export function buildLevel(levelNum: number): LevelLayout {
  const seed = (LEVELGEN_SEED_BASE ^ hashLevel(levelNum)) >>> 0;
  const rng = createRng(seed);
  const playerSpawn: Vec2 = { x: 0, z: 0 };
  const placed: PlacedCircle[] = [{ position: playerSpawn, radius: PLAYER_SAFE_RADIUS }];

  const spawnRange = ARENA_HALF_SIZE - EDGE_MARGIN;
  const randomPoint = (): Vec2 => ({
    x: (rng.next() * 2 - 1) * spawnRange,
    z: (rng.next() * 2 - 1) * spawnRange,
  });

  const farEnough = (p: Vec2, extraRadius: number): boolean => {
    for (const c of placed) {
      const dx = p.x - c.position.x;
      const dz = p.z - c.position.z;
      const minDist = c.radius + extraRadius + OBSTACLE_MIN_SEPARATION;
      if (dx * dx + dz * dz < minDist * minDist) return false;
    }
    return true;
  };

  const obstacles: Obstacle[] = [];

  for (let i = 0, attempts = 0; i < WALL_COUNT && attempts < WALL_COUNT * 50; attempts++) {
    const center = randomPoint();
    const sizeX = WALL_MIN_SIZE + rng.next() * (WALL_MAX_SIZE - WALL_MIN_SIZE);
    const sizeZ = WALL_MIN_SIZE + rng.next() * (WALL_MAX_SIZE - WALL_MIN_SIZE);
    const boundingRadius = dlen(sizeX, sizeZ) / 2;
    if (!farEnough(center, boundingRadius)) continue;

    obstacles.push({
      id: `wall-${i}`,
      kind: 'wall',
      min: { x: center.x - sizeX / 2, z: center.z - sizeZ / 2 },
      max: { x: center.x + sizeX / 2, z: center.z + sizeZ / 2 },
    });
    placed.push({ position: center, radius: boundingRadius });
    i++;
  }

  for (let i = 0, attempts = 0; i < WINDMILL_COUNT && attempts < WINDMILL_COUNT * 50; attempts++) {
    const center = randomPoint();
    const boundingRadius = WINDMILL_PYLON_RADIUS + WINDMILL_BLADE_LENGTH;
    if (!farEnough(center, boundingRadius)) continue;

    obstacles.push({
      id: `windmill-${i}`,
      kind: 'windmill',
      position: center,
      pylonRadius: WINDMILL_PYLON_RADIUS,
      bladeLength: WINDMILL_BLADE_LENGTH,
      bladeAngle: rng.next() * Math.PI * 2,
      prevBladeAngle: 0,
    });
    placed.push({ position: center, radius: boundingRadius });
    i++;
  }
  for (const o of obstacles) {
    if (o.kind === 'windmill') o.prevBladeAngle = o.bladeAngle;
  }

  const flags: Flag[] = [];
  for (let i = 0, attempts = 0; i < FLAGS_PER_LEVEL && attempts < FLAGS_PER_LEVEL * 100; attempts++) {
    const p = randomPoint();
    if (!farEnough(p, FLAG_COLLECT_RADIUS)) continue;
    flags.push({ id: `flag-${i}`, position: p, collected: false });
    placed.push({ position: p, radius: FLAG_COLLECT_RADIUS });
    i++;
  }

  const pickupSpecs: { kind: PickupKind; amount: number }[] = [
    ...Array.from({ length: AMMO_PICKUP_COUNT }, () => ({ kind: 'ammo' as const, amount: AMMO_PICKUP_AMOUNT })),
    ...Array.from({ length: SHIELD_PICKUP_COUNT }, () => ({ kind: 'shield' as const, amount: SHIELD_PICKUP_AMOUNT })),
  ];

  const pickups: Pickup[] = [];
  pickupSpecs.forEach((spec, i) => {
    for (let attempts = 0; attempts < 100; attempts++) {
      const p = randomPoint();
      if (!farEnough(p, PICKUP_COLLECT_RADIUS)) continue;
      pickups.push({ id: `pickup-${i}`, kind: spec.kind, amount: spec.amount, position: p, collected: false });
      placed.push({ position: p, radius: PICKUP_COLLECT_RADIUS });
      break;
    }
  });

  return { obstacles, flags, pickups };
}
