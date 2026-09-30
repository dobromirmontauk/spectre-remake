import type { Obstacle, Vec2 } from '../sim/types.ts';
export type Strategy = 'pursue' | 'patrol' | 'protect' | 'explore' | 'retreat' | 'regroup';
export type Team = 'player' | 'enemy';
export interface Contact { id: string; kind: 'tank' | 'flag' | 'pickup'; position: Vec2; seenTick: number; team?: Team; pickupKind?: 'ammo' | 'shield'; amount?: number; heading?: number; source?: 'own' | 'shared' | 'map'; seenSeconds?: number; ageSeconds?: number; strategy?: Strategy }
export interface TankMemory { seen: Record<string, Contact>; visited?: Vec2[]; seenPositions?: Record<string, Vec2>; lastShield?: number; recentThreat?: RecentThreat }
export interface RecentThreat { tick: number; seconds: number; ageSeconds: number; kind: 'damage' | 'projectile'; direction?: Vec2 }
export interface ObservationContext { sharedSightings?: Contact[]; strategies?: Record<string, Strategy> }
export interface TankObservation {
 level: number; nowSeconds: number; recentThreat?: RecentThreat;
 own: { id: string; team: Team; position: Vec2; heading: number; speed: number; shieldFraction: number; ammo: number; maxAmmo: number; shield: number; maxShield: number; fireReady: boolean; tick: number; lastStrategy?: Strategy };
 visited: Vec2[]; contacts: Contact[]; memory: Contact[]; geometry: Obstacle[]; bounds: number;
}
export interface TacticalPlan { id: string; description: string; waypoint: Vec2; lookAt?: Vec2; targetId?: string; fire: boolean; expiresTick: number; strategy?: Strategy }
