import type { Vec2 } from './types.ts';

export interface CircleHit {
  hit: boolean;
  penetration: number;
  normal: Vec2; // points from obstacle toward the circle
}

export function closestPointOnAABB(p: Vec2, min: Vec2, max: Vec2): Vec2 {
  return {
    x: Math.max(min.x, Math.min(p.x, max.x)),
    z: Math.max(min.z, Math.min(p.z, max.z)),
  };
}

export function circleVsAABB(center: Vec2, radius: number, min: Vec2, max: Vec2): CircleHit {
  const closest = closestPointOnAABB(center, min, max);
  const dx = center.x - closest.x;
  const dz = center.z - closest.z;
  const distSq = dx * dx + dz * dz;
  if (distSq >= radius * radius) {
    return { hit: false, penetration: 0, normal: { x: 0, z: 0 } };
  }

  const dist = Math.sqrt(distSq);
  if (dist > 1e-6) {
    return { hit: true, penetration: radius - dist, normal: { x: dx / dist, z: dz / dist } };
  }

  // Center is inside the box: push out along the axis with the least overlap.
  const candidates = [
    { normal: { x: -1, z: 0 }, dist: center.x - min.x },
    { normal: { x: 1, z: 0 }, dist: max.x - center.x },
    { normal: { x: 0, z: -1 }, dist: center.z - min.z },
    { normal: { x: 0, z: 1 }, dist: max.z - center.z },
  ];
  let best = candidates[0]!;
  for (const c of candidates) {
    if (c.dist < best.dist) best = c;
  }
  return { hit: true, penetration: radius + best.dist, normal: best.normal };
}

export function circleVsCircle(aCenter: Vec2, aRadius: number, bCenter: Vec2, bRadius: number): CircleHit {
  const dx = aCenter.x - bCenter.x;
  const dz = aCenter.z - bCenter.z;
  const distSq = dx * dx + dz * dz;
  const r = aRadius + bRadius;
  if (distSq >= r * r) {
    return { hit: false, penetration: 0, normal: { x: 0, z: 0 } };
  }
  const dist = Math.sqrt(distSq);
  if (dist > 1e-6) {
    return { hit: true, penetration: r - dist, normal: { x: dx / dist, z: dz / dist } };
  }
  return { hit: true, penetration: r, normal: { x: 1, z: 0 } };
}

export interface SweptHit {
  hit: boolean;
  t: number; // 0..1 along the segment where the hit occurs
  point: Vec2;
}

const NO_SWEPT_HIT: SweptHit = { hit: false, t: 1, point: { x: 0, z: 0 } };

// Closest-approach test between a moving point (segment p0->p1, one tick's
// travel) and a static circle — used for fast projectiles so they can't
// tunnel through a thin target within a single tick.
export function segmentVsCircle(p0: Vec2, p1: Vec2, center: Vec2, radius: number): SweptHit {
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const fx = p0.x - center.x;
  const fz = p0.z - center.z;

  const a = dx * dx + dz * dz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - radius * radius;

  if (a < 1e-9) {
    // Zero-length segment: static point-in-circle test.
    if (c <= 0) return { hit: true, t: 0, point: { x: p0.x, z: p0.z } };
    return NO_SWEPT_HIT;
  }

  const disc = b * b - 4 * a * c;
  if (disc < 0) return NO_SWEPT_HIT;

  const sqrtDisc = Math.sqrt(disc);
  const t0 = (-b - sqrtDisc) / (2 * a);
  const t1 = (-b + sqrtDisc) / (2 * a);

  // Smallest t in [0, 1]; if the segment starts inside the circle, t=0 hits.
  let t = -1;
  if (t0 >= 0 && t0 <= 1) t = t0;
  else if (t1 >= 0 && t1 <= 1) t = t1;
  else if (c <= 0) t = 0; // already overlapping at the start

  if (t < 0) return NO_SWEPT_HIT;
  return { hit: true, t, point: { x: p0.x + dx * t, z: p0.z + dz * t } };
}

// Slab-method swept segment-vs-AABB test, used so fast projectiles register
// hits on walls without tunneling through in a single tick.
export function segmentVsAABB(p0: Vec2, p1: Vec2, min: Vec2, max: Vec2): SweptHit {
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;

  let tMin = 0;
  let tMax = 1;

  for (const [origin, dir, lo, hi] of [
    [p0.x, dx, min.x, max.x],
    [p0.z, dz, min.z, max.z],
  ] as const) {
    if (Math.abs(dir) < 1e-9) {
      if (origin < lo || origin > hi) return NO_SWEPT_HIT;
      continue;
    }
    let t1 = (lo - origin) / dir;
    let t2 = (hi - origin) / dir;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return NO_SWEPT_HIT;
  }

  return { hit: true, t: tMin, point: { x: p0.x + dx * tMin, z: p0.z + dz * tMin } };
}

// Arena is 4 half-planes forming a square; clamps a circle to stay inside.
export function containInArena(
  center: Vec2,
  radius: number,
  halfSize: number,
): { x: number; z: number; hitWall: boolean } {
  const min = -halfSize + radius;
  const max = halfSize - radius;
  let x = center.x;
  let z = center.z;
  let hitWall = false;

  if (x < min) {
    x = min;
    hitWall = true;
  } else if (x > max) {
    x = max;
    hitWall = true;
  }

  if (z < min) {
    z = min;
    hitWall = true;
  } else if (z > max) {
    z = max;
    hitWall = true;
  }

  return { x, z, hitWall };
}
