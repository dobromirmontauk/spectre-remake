import type { Loadout, MovementParams, TankState } from './types.ts';
import type { Command } from './commands.ts';
import { dcos, dsin } from './dmath.ts';
import {
  SIM_DT,
  TURN_RATE,
  THRUST_ACCEL,
  REVERSE_ACCEL,
  COAST_FRICTION,
  MAX_SPEED,
  MAX_REVERSE_SPEED,
  LOADOUT_SPEED_REFERENCE,
  LOADOUT_SPEED_TO_WORLD,
  LOADOUT_TURN_RATE_SCALE_MIN,
  LOADOUT_TURN_RATE_SCALE_RANGE,
  LOADOUT_THRUST_SCALE_MIN,
  LOADOUT_THRUST_SCALE_RANGE,
} from '../config/constants.ts';

export type { MovementParams };

// Balanced-preset defaults; also the fallback for any call site that doesn't
// pass params explicitly (enemies always pass their own; each player passes
// their own PlayerState.movement, derived below from their chosen Loadout).
export const PLAYER_MOVEMENT_PARAMS: MovementParams = {
  turnRate: TURN_RATE,
  thrustAccel: THRUST_ACCEL,
  reverseAccel: REVERSE_ACCEL,
  coastFriction: COAST_FRICTION,
  maxSpeed: MAX_SPEED,
  maxReverseSpeed: MAX_REVERSE_SPEED,
};

// Derives full MovementParams from a tank-setup Loadout. A faster loadout
// gets a bit more turn rate and acceleration too (judgment call — a top-speed
// stat alone made "Speedy" feel sluggish off the line and in turns relative
// to "Strong"), scaled between the same min/max the preset sliders allow.
export function deriveMovementParams(loadout: Loadout): MovementParams {
  const speedFrac = Math.max(0, Math.min(1, loadout.speed / LOADOUT_SPEED_REFERENCE));
  return {
    turnRate: TURN_RATE * (LOADOUT_TURN_RATE_SCALE_MIN + LOADOUT_TURN_RATE_SCALE_RANGE * speedFrac),
    thrustAccel: THRUST_ACCEL * (LOADOUT_THRUST_SCALE_MIN + LOADOUT_THRUST_SCALE_RANGE * speedFrac),
    reverseAccel: REVERSE_ACCEL,
    coastFriction: COAST_FRICTION,
    maxSpeed: loadout.speed * LOADOUT_SPEED_TO_WORLD,
    maxReverseSpeed: MAX_REVERSE_SPEED,
  };
}

// Heading turn + thrust with acceleration and coast/friction — Battlezone-like
// tank inertia. Mutates tank in place; caller is responsible for collision
// resolution afterward. `params` lets enemy tanks (ai.ts) reuse this with
// their own turn-rate/speed stats instead of the player's.
export function applyMovement(tank: TankState, cmd: Command, params: MovementParams = PLAYER_MOVEMENT_PARAMS): void {
  tank.prevPosition.x = tank.position.x;
  tank.prevPosition.z = tank.position.z;
  tank.prevHeading = tank.heading;

  if (cmd.turn !== 0) {
    tank.heading += cmd.turn * params.turnRate * SIM_DT;
  }

  if (cmd.thrust > 0) {
    tank.speed += params.thrustAccel * SIM_DT;
  } else if (cmd.thrust < 0) {
    tank.speed -= params.reverseAccel * SIM_DT;
  } else if (tank.speed > 0) {
    tank.speed = Math.max(0, tank.speed - params.coastFriction * SIM_DT);
  } else if (tank.speed < 0) {
    tank.speed = Math.min(0, tank.speed + params.coastFriction * SIM_DT);
  }

  tank.speed = Math.max(-params.maxReverseSpeed, Math.min(params.maxSpeed, tank.speed));

  tank.position.x += dsin(tank.heading) * tank.speed * SIM_DT;
  tank.position.z += dcos(tank.heading) * tank.speed * SIM_DT;
}
