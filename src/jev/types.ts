import type { Personality } from './personality.ts';
import type { Obstacle, Vec2 } from '../sim/types.ts';
export type Strategy = 'pursue' | 'patrol' | 'protect' | 'explore' | 'retreat' | 'regroup';
export type Team = 'player' | 'enemy';
export interface Contact { id: string; kind: 'tank' | 'flag' | 'pickup'; position: Vec2; seenTick: number; team?: Team; pickupKind?: 'ammo' | 'shield'; amount?: number; heading?: number; source?: 'own' | 'shared' | 'map'; seenSeconds?: number; ageSeconds?: number; strategy?: Strategy }
export interface TankMemory { seen: Record<string, Contact>; visited?: Vec2[]; seenPositions?: Record<string, Vec2>; lastShield?: number; recentThreat?: RecentThreat }
export interface RecentThreat { tick: number; seconds: number; ageSeconds: number; kind: 'damage' | 'projectile'; direction?: Vec2 }
export type MissionKind = 'search' | 'hunt' | 'intercept' | 'attack' | 'recover';
export interface SquadMission { id:string; kind:MissionKind; role:'scout'|'flanker'|'interceptor'|'assault'|'support'; assignedTick:number; reviewTick:number; waypoint:Vec2; targetId?:string; track?:{position:Vec2;heading?:number;seenTick:number;ageSeconds:number;uncertainty:number}; reason:string }
export interface MotionFeedback { firedRecently?:boolean; windowTicks:number; distanceMoved:number; stalledTicks:number; blockedTicks:number; lastIntervention?:'wall'|'tank'; failedWaypoint?:Vec2; progress:boolean }
export interface ObservationContext { radio?:boolean; sharedObjectives?:Contact[]; sharedSightings?: Contact[]; strategies?: Record<string, Strategy> }
export interface TankObservation {
 mission?:SquadMission; remainingFlags: number; totalFlags: number; level: number; nowSeconds: number; recentThreat?: RecentThreat;
 own: { livesRemaining?:number; motionFeedback?:MotionFeedback; personality?: Personality; id: string; team: Team; position: Vec2; heading: number; speed: number; shieldFraction: number; ammo: number; maxAmmo: number; shield: number; maxShield: number; fireReady: boolean; tick: number; lastStrategy?: Strategy };
 visited: Vec2[]; contacts: Contact[]; memory: Contact[]; geometry: Obstacle[]; bounds: number;
}
export interface TacticalPlan { backing?:boolean; missionId?:string; tactic?:'advance'|'peek'|'fire'|'reposition'|'evade'|'cover'; id: string; description: string; waypoint: Vec2; lookAt?: Vec2; targetId?: string; fire: boolean; expiresTick: number; strategy?: Strategy }
