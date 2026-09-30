import type { Obstacle, Vec2 } from '../sim/types.ts';
export type Team = 'player' | 'enemy';
export interface Contact { id: string; kind: 'tank' | 'flag' | 'pickup'; position: Vec2; seenTick: number; team?: Team; pickupKind?: 'ammo' | 'shield'; amount?: number }
export interface TankMemory { seen: Record<string, Contact>; visited?: Vec2[] }
export interface TankObservation {
 own: { id: string; team: Team; position: Vec2; heading: number; speed: number; shieldFraction: number; ammo: number; maxAmmo: number; shield: number; maxShield: number; fireReady: boolean; tick: number };
 visited: Vec2[]; contacts: Contact[]; memory: Contact[]; geometry: Obstacle[]; bounds: number;
}
export interface TacticalPlan { id: string; description: string; waypoint: Vec2; lookAt?: Vec2; targetId?: string; fire: boolean; expiresTick: number }
