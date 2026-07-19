// Compares buildLevel's obstacle/flag/pickup layout for levels 1..50 between
// the pre-M1 Math.hypot(sizeX, sizeZ) formula and the post-M1
// dlen(sizeX, sizeZ) = Math.sqrt(sizeX*sizeX + sizeZ*sizeZ) replacement (see
// sim/levelgen.ts's one call site, sim/dmath.ts's dlen doc comment for why
// hypot itself isn't deterministic across engines).
//
// Both formulas are mathematically identical; this only measures whether
// they round differently often enough near a farEnough() accept/reject
// threshold to flip which obstacles get placed. Run with:
//   node scripts/levelgen-diff.mjs

// mulberry32, matching sim/rng.ts exactly.
function createRng(seed) {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function hashLevel(level) {
  let h = (level ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

// --- constants, copied from config/constants.ts (only what buildLevel uses) ---
const ARENA_HALF_SIZE = 100;
const LEVELGEN_SEED_BASE = 0x5ec7e123;
const WALL_COUNT = 8;
const WINDMILL_COUNT = 4;
const WALL_MIN_SIZE = 4;
const WALL_MAX_SIZE = 10;
const OBSTACLE_MIN_SEPARATION = 14;
const EDGE_MARGIN = 8;
const WINDMILL_PYLON_RADIUS = 1.2;
const WINDMILL_BLADE_LENGTH = 6;
const PLAYER_SAFE_RADIUS = 25;
const FLAGS_PER_LEVEL = 10;
const FLAG_COLLECT_RADIUS = 2.5;
const AMMO_PICKUP_COUNT = 4;
const SHIELD_PICKUP_COUNT = 4;
const PICKUP_COLLECT_RADIUS = 2.2;
const AMMO_PICKUP_AMOUNT = 20;
const SHIELD_PICKUP_AMOUNT = 25;

// buildLevel, parameterized by which "radius of a rectangle's half-diagonal"
// formula it uses — the only thing that changed.
function buildLevel(levelNum, diagFn) {
  const seed = (LEVELGEN_SEED_BASE ^ hashLevel(levelNum)) >>> 0;
  const rng = createRng(seed);
  const playerSpawn = { x: 0, z: 0 };
  const placed = [{ position: playerSpawn, radius: PLAYER_SAFE_RADIUS }];

  const spawnRange = ARENA_HALF_SIZE - EDGE_MARGIN;
  const randomPoint = () => ({
    x: (rng.next() * 2 - 1) * spawnRange,
    z: (rng.next() * 2 - 1) * spawnRange,
  });

  const farEnough = (p, extraRadius) => {
    for (const c of placed) {
      const dx = p.x - c.position.x;
      const dz = p.z - c.position.z;
      const minDist = c.radius + extraRadius + OBSTACLE_MIN_SEPARATION;
      if (dx * dx + dz * dz < minDist * minDist) return false;
    }
    return true;
  };

  const obstacles = [];

  for (let i = 0, attempts = 0; i < WALL_COUNT && attempts < WALL_COUNT * 50; attempts++) {
    const center = randomPoint();
    const sizeX = WALL_MIN_SIZE + rng.next() * (WALL_MAX_SIZE - WALL_MIN_SIZE);
    const sizeZ = WALL_MIN_SIZE + rng.next() * (WALL_MAX_SIZE - WALL_MIN_SIZE);
    const boundingRadius = diagFn(sizeX, sizeZ) / 2;
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

    obstacles.push({ id: `windmill-${i}`, kind: 'windmill', position: center });
    placed.push({ position: center, radius: boundingRadius });
    i++;
  }

  const flags = [];
  for (let i = 0, attempts = 0; i < FLAGS_PER_LEVEL && attempts < FLAGS_PER_LEVEL * 100; attempts++) {
    const p = randomPoint();
    if (!farEnough(p, FLAG_COLLECT_RADIUS)) continue;
    flags.push({ id: `flag-${i}`, position: p });
    placed.push({ position: p, radius: FLAG_COLLECT_RADIUS });
    i++;
  }

  const pickupSpecs = [
    ...Array.from({ length: AMMO_PICKUP_COUNT }, () => ({ kind: 'ammo', amount: AMMO_PICKUP_AMOUNT })),
    ...Array.from({ length: SHIELD_PICKUP_COUNT }, () => ({ kind: 'shield', amount: SHIELD_PICKUP_AMOUNT })),
  ];

  const pickups = [];
  pickupSpecs.forEach((spec, i) => {
    for (let attempts = 0; attempts < 100; attempts++) {
      const p = randomPoint();
      if (!farEnough(p, PICKUP_COLLECT_RADIUS)) continue;
      pickups.push({ id: `pickup-${i}`, kind: spec.kind, position: p });
      placed.push({ position: p, radius: PICKUP_COLLECT_RADIUS });
      break;
    }
  });

  return { obstacles, flags, pickups };
}

function layoutsEqual(a, b) {
  if (a.obstacles.length !== b.obstacles.length) return false;
  if (a.flags.length !== b.flags.length) return false;
  if (a.pickups.length !== b.pickups.length) return false;
  for (let i = 0; i < a.obstacles.length; i++) {
    if (JSON.stringify(a.obstacles[i]) !== JSON.stringify(b.obstacles[i])) return false;
  }
  for (let i = 0; i < a.flags.length; i++) {
    if (JSON.stringify(a.flags[i]) !== JSON.stringify(b.flags[i])) return false;
  }
  for (let i = 0; i < a.pickups.length; i++) {
    if (JSON.stringify(a.pickups[i]) !== JSON.stringify(b.pickups[i])) return false;
  }
  return true;
}

let changed = 0;
const changedLevels = [];
for (let level = 1; level <= 50; level++) {
  const oldLayout = buildLevel(level, (x, z) => Math.hypot(x, z));
  const newLayout = buildLevel(level, (x, z) => Math.sqrt(x * x + z * z));
  if (!layoutsEqual(oldLayout, newLayout)) {
    changed++;
    changedLevels.push(level);
  }
}

console.log(`Levels 1-50: ${changed} layout(s) changed by the Math.hypot -> dlen swap.`);
if (changed > 0) console.log(`Changed levels: ${changedLevels.join(', ')}`);
