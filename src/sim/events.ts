// Events emitted by step() for one tick. Consumers (HUD, audio, flow) drain
// state.events once per render frame.

import type { PickupKind, Vec2 } from './types.ts';

export type SimEvent =
  | { type: 'FlagCollected'; flagId: string; flagsCollected: number }
  | { type: 'PickupCollected'; pickupId: string; kind: PickupKind; amount: number }
  | { type: 'WallHit'; obstacleId: string }
  | { type: 'LevelComplete'; level: number }
  | { type: 'ShotFired'; ownerId: string; position: Vec2; heading: number }
  | { type: 'ShotHit'; position: Vec2; targetKind: 'enemy' | 'player' | 'obstacle' | 'bounds' }
  | { type: 'GrenadeFired'; ownerId: string; position: Vec2; heading: number }
  | { type: 'GrenadeExploded'; position: Vec2; radius: number }
  | { type: 'EnemyDestroyed'; enemyId: string; position: Vec2 }
  | { type: 'EnemyRespawned'; enemyId: string; position: Vec2 }
  | { type: 'PlayerDamaged'; amount: number }
  | { type: 'PlayerDestroyed'; position: Vec2; livesRemaining: number }
  | { type: 'PlayerRespawned' }
  | { type: 'GameOver'; finalScore: number; finalLevel: number };
