// Wire message shapes exchanged over a NetTransport (see transport.ts).
// PROTOCOL_VERSION lives in config/constants.ts (it's a tunable like
// everything else there); BUILD_HASH comes from the Vite `__BUILD_HASH__`
// define (vite.config.ts), which stamps `git rev-parse --short HEAD` at
// build time ('dev' outside a git checkout, or under `npm run dev`).

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

export interface NetMessageMap {
  hello: HelloMessage;
  reject: RejectMessage;
  lobby: LobbyMessage;
  loadoutPick: LoadoutPickMessage;
  start: StartMessage;
  bye: ByeMessage;
}

export type NetMessageKind = keyof NetMessageMap;
