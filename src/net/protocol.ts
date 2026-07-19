// Wire message shapes exchanged over a NetTransport (see transport.ts).
// PROTOCOL_VERSION lives in config/constants.ts (it's a tunable like
// everything else there); BUILD_HASH comes from the Vite `__BUILD_HASH__`
// define (vite.config.ts), which stamps `git rev-parse --short HEAD` at
// build time ('dev' outside a git checkout, or under `npm run dev`).

import type { Command } from '../sim/commands.ts';
import type { GameMode, Loadout } from '../sim/types.ts';

declare const __BUILD_HASH__: string;
export const BUILD_HASH: string = __BUILD_HASH__;

export interface RosterEntry {
  peerId: string;
  slot: number; // 0-7, host-assigned; index into config/palette.ts PLAYER_TANK_COLOR_SLOTS
  name: string;
  loadout: Loadout;
}

export interface HelloMessage {
  name: string;
  protoVersion: number;
  buildHash: string;
}

export type RejectReason = 'full' | 'version' | 'started';

export interface RejectMessage {
  reason: RejectReason;
  detail?: string; // e.g. version mismatch: both builds' identifiers, for the error dialog
}

export interface LobbyMessage {
  hostId: string;
  mode: GameMode;
  roster: RosterEntry[];
  started: boolean;
}

export interface LoadoutPickMessage {
  loadout: Loadout;
}

// Type only in M2 — M3 wires the host->peers match-start handshake over this.
export interface StartMessage {
  mode: GameMode;
  level: number;
  roster: RosterEntry[];
  inputDelay: number;
}

export interface ByeMessage {
  peerId: string;
}

// --- M3: lockstep wire messages ---

// Packs a Command into one small integer (0-63) for the `input` wire
// message: turn (2 bits, value+1 so -1/0/1 -> 0/1/2), thrust (2 bits, same
// encoding), fire (1 bit), grenade (1 bit). Round-trip verified for all 36
// Command combinations (see the M3 commit's scratch check).
export function packCommand(cmd: Command): number {
  const turnBits = (cmd.turn + 1) & 0b11;
  const thrustBits = (cmd.thrust + 1) & 0b11;
  const fireBit = cmd.fire ? 1 : 0;
  const grenadeBit = cmd.grenade ? 1 : 0;
  return turnBits | (thrustBits << 2) | (fireBit << 4) | (grenadeBit << 5);
}

export function unpackCommand(packed: number): Command {
  const turn = ((packed & 0b11) - 1) as -1 | 0 | 1;
  const thrust = (((packed >> 2) & 0b11) - 1) as -1 | 0 | 1;
  const fire = ((packed >> 4) & 1) === 1;
  const grenade = ((packed >> 5) & 1) === 1;
  return { turn, thrust, fire, grenade };
}

// One player slot's commands for a run of ticks starting at `firstTick`
// (length INPUT_REDUNDANCY, clipped at 0) — see net/lockstep.ts.
export interface InputMessage {
  slot: number;
  firstTick: number;
  cmds: number[]; // packed via packCommand, index i => tick firstTick+i
}

// Desync-detection primitive (see sim/hash.ts) exchanged every
// HASH_INTERVAL_TICKS ticks.
export interface HashMessage {
  tick: number;
  hash: number;
}

// Type only in M3 (host-authoritative disconnect/removal logic lands in
// M5) — peers that receive this before then can safely ignore it.
export interface DropMessage {
  slot: number;
  effectiveTick: number;
}

export interface NetMessageMap {
  hello: HelloMessage;
  reject: RejectMessage;
  lobby: LobbyMessage;
  loadoutPick: LoadoutPickMessage;
  start: StartMessage;
  bye: ByeMessage;
  input: InputMessage;
  hash: HashMessage;
  drop: DropMessage;
}

export type NetMessageKind = keyof NetMessageMap;

// Runtime enumeration of the same keys as NetMessageMap — TrysteroTransport
// (net/trystero.ts) needs an actual array to create one trystero action
// channel per message kind (types alone don't exist at runtime). Kept here,
// next to NetMessageMap, so the two can't drift apart.
export const NET_MESSAGE_KINDS: NetMessageKind[] = [
  'hello',
  'reject',
  'lobby',
  'loadoutPick',
  'start',
  'bye',
  'input',
  'hash',
  'drop',
];
