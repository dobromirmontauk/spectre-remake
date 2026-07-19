// Plain-data game state. No functions except the rng helper object below;
// no three.js or DOM references are permitted anywhere in sim/.

import type { SimEvent } from './events.ts';

export interface Vec2 {
  x: number;
  z: number;
}

export interface RngState {
  state: number;
  next(): number;
}

// Per-tank movement tuning. The player's variant is derived from the chosen
// Loadout (tank setup screen); enemies get their own fixed set per kind/level
// (see sim/ai.ts). Plain data so it can live on GameState.
export interface MovementParams {
  turnRate: number;
  thrustAccel: number;
  reverseAccel: number;
  coastFriction: number;
  maxSpeed: number;
  maxReverseSpeed: number;
}

// Player stat allocation chosen on the tank-setup screen (Balanced/Speedy/
// Strong/Custom). Part of initial state, not a runtime input — baked into
// the player's maxShield/maxAmmo and derived MovementParams at game start.
export interface Loadout {
  speed: number; // top speed, same scale as MovementParams.maxSpeed (0-18)
  shields: number; // player maxShield
  ammo: number; // player maxAmmo (cap 127)
}

export interface TankState {
  id: string;
  position: Vec2;
  prevPosition: Vec2;
  heading: number; // radians; 0 = facing +z, increases toward +x
  prevHeading: number;
  speed: number; // signed units/sec, forward positive
  shield: number;
  maxShield: number;
  ammo: number;
  maxAmmo: number;
  alive: boolean;
  fireCooldown: number; // ticks remaining until cannon can fire again
  grenadeCooldown: number; // ticks remaining until grenade can be thrown again (player only)
}

export type EnemyKind = 'drone' | 'hunter';
export type EnemyAiState = 'PURSUE' | 'FIRE' | 'UNSTICK';

export interface EnemyState extends TankState {
  kind: EnemyKind;
  aiState: EnemyAiState;
  stuckTicks: number; // ticks spent nearly stationary while thrusting (wedged detection)
  unstickTicksRemaining: number; // ticks left in the current UNSTICK maneuver
  unstickTurnDir: -1 | 1;
  respawnTicksRemaining: number; // 0 while alive; counts down to respawn while dead
}

export interface Projectile {
  id: string;
  ownerId: string;
  position: Vec2;
  prevPosition: Vec2;
  heading: number; // travel direction, radians (also used for tracer orientation)
  speed: number;
  ticksRemaining: number; // range limit — despawns silently at 0
}

export interface Grenade {
  id: string;
  ownerId: string;
  position: Vec2;
  prevPosition: Vec2;
  heading: number;
  speed: number;
  fuseTicksRemaining: number; // explodes when this reaches 0 or on obstacle/wall hit
}

export interface WallObstacle {
  id: string;
  kind: 'wall';
  min: Vec2;
  max: Vec2;
}

export interface WindmillObstacle {
  id: string;
  kind: 'windmill';
  position: Vec2;
  pylonRadius: number;
  bladeLength: number;
  bladeAngle: number; // radians, advanced each sim tick
  prevBladeAngle: number;
}

export type Obstacle = WallObstacle | WindmillObstacle;

export interface Flag {
  id: string;
  position: Vec2;
  collected: boolean;
}

export type PickupKind = 'ammo' | 'shield';

export interface Pickup {
  id: string;
  kind: PickupKind;
  position: Vec2;
  amount: number;
  collected: boolean;
}

export interface GameState {
  tick: number;
  level: number;
  rng: RngState;
  loadout: Loadout;
  playerMovement: MovementParams; // derived from `loadout` once at game start; see sim/movement.ts
  player: TankState;
  obstacles: Obstacle[];
  flags: Flag[];
  pickups: Pickup[];
  flagsCollected: number;
  enemies: EnemyState[];
  projectiles: Projectile[];
  grenades: Grenade[];
  lives: number;
  score: number;
  bonusRemaining: number; // per-level time bonus, counts down; added to score on LevelComplete
  invulnerableTicks: number; // player-only brief invulnerability after respawn
  gameOver: boolean;
  god: boolean; // debug: player takes no damage
  nextEntityId: number; // monotonic counter for enemy/projectile/grenade ids
  events: SimEvent[]; // this tick's events; consumers drain per render frame
}
