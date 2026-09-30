// Deterministic reflex-only scene check. Nothing here is included in model observations.
import type { GameState, TankState } from './types.ts';
import { dsin, dcos } from './dmath.ts';
import { segmentVsCircle } from './collision.ts';
import { movementParamsForEnemy } from './ai.ts';
import { levelConfig } from '../config/levels.ts';
import { ARENA_HALF_SIZE, PROJECTILE_MAX_TICKS, PROJECTILE_RADIUS, PROJECTILE_SPEED, SIM_DT, TANK_RADIUS } from '../config/constants.ts';

export function friendlyInProjectilePath(state: GameState, owner: TankState, heading = owner.heading): boolean {
  const allies = state.players.some(p => p.id === owner.id) ? state.players : state.enemies;
  const dx = dsin(heading) * PROJECTILE_SPEED * SIM_DT, dz = dcos(heading) * PROJECTILE_SPEED * SIM_DT;
  const cfg = levelConfig(state.level);
  for (const ally of allies) {
    if (ally.id === owner.id || !ally.alive) continue;
    const params = state.players.find(p => p.id === ally.id)?.movement ?? movementParamsForEnemy(state.enemies.find(e => e.id === ally.id)!.kind, cfg);
    const speed = Math.abs(ally.speed);
    const speedCap = Math.max(speed, params.maxSpeed, params.maxReverseSpeed);
    const acceleration = Math.max(params.thrustAccel, params.reverseAccel, params.coastFriction);
    let before = { ...owner.position };
    for (let tick = 1; tick <= PROJECTILE_MAX_TICKS; tick++) {
      const after = { x: before.x + dx, z: before.z + dz };
      // An ally may still move later in this sim tick, and can turn after launch.
      // Bound its entire reachable displacement, rather than trusting current heading
      // or assuming the intended target absorbs the shell. This includes allies behind it.
      const time = (tick + 1) * SIM_DT;
      const reachable = Math.min(speedCap * time, speed * time + acceleration * time * time / 2);
      const radius = TANK_RADIUS + PROJECTILE_RADIUS + reachable;
      if (segmentVsCircle(before, after, ally.position, radius).hit) return true;
      before = after;
      // The first out-of-bounds segment still performs hit tests in weapons.ts.
      if (Math.abs(after.x) > ARENA_HALF_SIZE || Math.abs(after.z) > ARENA_HALF_SIZE) break;
    }
  }
  return false;
}
