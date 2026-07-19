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
  invulnerableTicks: number; // per-tank so two human players can be invulnerable independently (post-respawn brief window)
  lastHitBy: string | null; // id of the tank whose shot/grenade last damaged this one; used for duel kill credit
  respawnTicksRemaining: number; // 0 while alive; counts down to respawn (enemies always; players only in duel mode)
}

export type EnemyKind = 'drone' | 'hunter';
export type EnemyAiState = 'PURSUE' | 'FIRE' | 'UNSTICK';

export interface EnemyState extends TankState {
  kind: EnemyKind;
  aiState: EnemyAiState;
  stuckTicks: number; // ticks spent nearly stationary while thrusting (wedged detection)
  unstickTicksRemaining: number; // ticks left in the current UNSTICK maneuver
  unstickTurnDir: -1 | 1;
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

// 'solo' — unchanged 1-player game. 'coop' — two players share the arena and
// score against AI enemies (each has own lives). 'duel' — two players fight
// each other, no AI/flags, first to a kill target wins (see DUEL_KILL_TARGET).
export type GameMode = 'solo' | 'coop' | 'duel';

export interface GameState {
  tick: number;
  level: number;
  rng: RngState;
  mode: GameMode;
  loadout: Loadout;
  playerMovement: MovementParams; // derived from `loadout` once at game start; see sim/movement.ts
  player: TankState;
  loadout2: Loadout; // player2's chosen loadout; meaningful only when player2 is non-null
  player2Movement: MovementParams; // derived from `loadout2`, mirrors playerMovement
  player2: TankState | null; // second human tank; present only in 'coop'/'duel'
  obstacles: Obstacle[];
  flags: Flag[];
  pickups: Pickup[];
  flagsCollected: number;
  enemies: EnemyState[];
  projectiles: Projectile[];
  grenades: Grenade[];
  lives: number; // player's lives (solo and coop)
  lives2: number; // player2's lives (coop only; unused in solo/duel)
  score: number; // shared score in solo/coop; unused in duel
  bonusRemaining: number; // per-level time bonus, counts down; added to score on LevelComplete
  kills: { player: number; player2: number }; // duel kill tally; {0,0} and unused outside duel
  winner: 'player' | 'player2' | null; // duel-only: set once a side reaches DUEL_KILL_TARGET
  gameOver: boolean;
  god: boolean; // debug: player takes no damage
  nextEntityId: number; // monotonic counter for enemy/projectile/grenade ids
  events: SimEvent[]; // this tick's events; consumers drain per render frame
}
