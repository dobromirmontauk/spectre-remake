// Host-authoritative lobby state machine, layered on a NetTransport (see
// transport.ts) and the message shapes in protocol.ts. Exactly one peer per
// room is host (whoever called host()); everyone else is a joiner. Only the
// host ever mutates `roster`/`mode` in response to network activity — it
// recomputes and rebroadcasts a fresh `lobby` message on every change, and
// joiners simply adopt whatever the host last broadcast. This keeps every
// peer's view consistent without a "last write wins" race on the roster.
//
// M3 will drive the actual match start over this same hello/lobby exchange
// (protocol.ts's StartMessage is defined but unused until then).

import type { GameMode, Loadout } from '../sim/types.ts';
import { DEFAULT_LOADOUT, MAX_PLAYERS, NET_ROOM_NOT_FOUND_TIMEOUT_MS, PROTOCOL_VERSION } from '../config/constants.ts';
import type { NetTransport, Unsubscribe } from './transport.ts';
import {
  BUILD_HASH,
  type ByeMessage,
  type HelloMessage,
  type LoadoutPickMessage,
  type LobbyMessage,
  type RejectMessage,
  type RosterEntry,
  type StartMessage,
} from './protocol.ts';

export type LobbyErrorReason = 'not-found' | 'full' | 'started' | 'version' | 'host-left' | 'relay-unreachable';

export interface LobbyError {
  reason: LobbyErrorReason;
  detail?: string;
}

// Used only by Playwright/debug verification to provoke a version mismatch
// without shipping two different builds — see game/debug.ts's __game.net
// and net/CLAUDE.md's M2 verification notes.
export interface JoinDebugOverride {
  protoVersion?: number;
  buildHash?: string;
}

type Listener = () => void;
type ErrorListener = (err: LobbyError) => void;
type StartListener = (msg: StartMessage) => void;

// DEFAULT_LOADOUT is a LoadoutPreset (carries `id`/`name` too) — strip it
// down to the plain {speed,shields,ammo} shape RosterEntry.loadout expects
// on the wire.
const DEFAULT_NET_LOADOUT: Loadout = { speed: DEFAULT_LOADOUT.speed, shields: DEFAULT_LOADOUT.shields, ammo: DEFAULT_LOADOUT.ammo };

export class NetLobby {
  private readonly transport: NetTransport;
  private readonly unsubMessage: Unsubscribe;
  private readonly unsubPeerLeave: Unsubscribe;
  private readonly listeners = new Set<Listener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly startListeners = new Set<StartListener>();

  private code: string | null = null;
  private isHostFlag = false;
  private hostPeerIdField: string | null = null;
  private mode: GameMode = 'coop';
  private roster: RosterEntry[] = [];
  private started = false;

  constructor(transport: NetTransport) {
    this.transport = transport;
    this.unsubMessage = transport.onMessage((kind, payload, from) => this.handleMessage(kind, payload, from));
    this.unsubPeerLeave = transport.onPeerLeave((peerId) => this.handlePeerGone(peerId));
  }

  onChange(fn: Listener): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onError(fn: ErrorListener): Unsubscribe {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  // Fires on every peer (host included — see startMatch()) the moment a
  // match actually begins. game/netscreens.ts forwards this to app.ts's
  // NetSession construction (see net/session.ts).
  onStart(fn: StartListener): Unsubscribe {
    this.startListeners.add(fn);
    return () => this.startListeners.delete(fn);
  }

  get roomCode(): string | null {
    return this.code;
  }

  get selfId(): string {
    return this.transport.selfId;
  }

  get isHost(): boolean {
    return this.isHostFlag;
  }

  get hostPeerId(): string | null {
    return this.hostPeerIdField;
  }

  get currentMode(): GameMode {
    return this.mode;
  }

  get currentRoster(): RosterEntry[] {
    return this.roster;
  }

  async host(roomCode: string, name: string): Promise<void> {
    await this.transport.join(roomCode);
    this.code = roomCode;
    this.isHostFlag = true;
    this.hostPeerIdField = this.transport.selfId;
    this.roster = [{ peerId: this.transport.selfId, slot: 0, name, loadout: DEFAULT_NET_LOADOUT }];
    this.emitChange();
  }

  join(roomCode: string, name: string, debugOverride?: JoinDebugOverride): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let unsub: Unsubscribe = () => {};
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        unsub();
        const err: LobbyError = { reason: 'not-found' };
        this.emitError(err);
        reject(err);
      }, NET_ROOM_NOT_FOUND_TIMEOUT_MS);

      unsub = this.transport.onMessage((kind, payload) => {
        if (settled) return;
        if (kind === 'lobby') {
          settled = true;
          window.clearTimeout(timer);
          unsub();
          const msg = payload as LobbyMessage;
          this.code = roomCode;
          this.isHostFlag = false;
          this.hostPeerIdField = msg.hostId;
          this.mode = msg.mode;
          this.roster = msg.roster;
          this.started = msg.started;
          this.emitChange();
          resolve();
        } else if (kind === 'reject') {
          settled = true;
          window.clearTimeout(timer);
          unsub();
          const msg = payload as RejectMessage;
          const reason: LobbyErrorReason = msg.reason === 'full' ? 'full' : msg.reason === 'started' ? 'started' : 'version';
          const err: LobbyError = { reason, detail: msg.detail };
          this.emitError(err);
          reject(err);
        }
      });

      this.transport
        .join(roomCode)
        .then(() => {
          const hello: HelloMessage = {
            name,
            protoVersion: debugOverride?.protoVersion ?? PROTOCOL_VERSION,
            buildHash: debugOverride?.buildHash ?? BUILD_HASH,
          };
          this.transport.send('hello', hello);
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          unsub();
          const err: LobbyError = { reason: 'relay-unreachable' };
          this.emitError(err);
          reject(err);
        });
    });
  }

  pickLoadout(loadout: Loadout): void {
    if (this.isHostFlag) {
      const entry = this.roster.find((r) => r.peerId === this.transport.selfId);
      if (!entry) return;
      entry.loadout = loadout;
      this.broadcastLobby();
    } else if (this.hostPeerIdField) {
      const msg: LoadoutPickMessage = { loadout };
      this.transport.send('loadoutPick', msg, this.hostPeerIdField);
    }
  }

  setMode(mode: GameMode): void {
    if (!this.isHostFlag) return;
    this.mode = mode;
    this.broadcastLobby();
  }

  // Host-only: begins the match. Broadcasts `start` to every joiner AND
  // fires onStart() locally (peers never receive their own broadcast — see
  // net/broadcast.ts/loopback.ts, which never loop a message back to its
  // sender), so the host enters the match through the exact same path as
  // everyone else. No extra seed needed — level fully determines the sim
  // (see net/CLAUDE.md); `roster` order is the slot order every peer must
  // reconstruct createInitialState/resetGameWithRoster with.
  startMatch(level: number, inputDelay: number): void {
    if (!this.isHostFlag) return;
    this.started = true;
    const msg: StartMessage = { mode: this.mode, level, roster: [...this.roster], inputDelay };
    this.transport.send('start', msg);
    this.emitStart(msg);
  }

  // Called by every peer once a match ends (GameOver -> Enter, back to
  // NetLobby with the room still alive) so the host can Start another —
  // resets the "match in progress" gate that would otherwise reject new
  // joiners' `hello` (see handleHello). Only the host's flag actually gates
  // anything; non-host peers reset their own copy for consistency and
  // in case they later become host of a new room.
  markMatchEnded(): void {
    this.started = false;
    if (this.isHostFlag) this.broadcastLobby();
  }

  leave(): void {
    const bye: ByeMessage = { peerId: this.transport.selfId };
    this.transport.send('bye', bye);
    this.transport.leave();
    this.unsubMessage();
    this.unsubPeerLeave();
    this.code = null;
    this.roster = [];
  }

  private handleMessage(kind: string, payload: unknown, from: string): void {
    if (kind === 'hello') this.handleHello(payload as HelloMessage, from);
    else if (kind === 'lobby' && !this.isHostFlag) this.handleLobbyBroadcast(payload as LobbyMessage);
    else if (kind === 'loadoutPick') this.handleLoadoutPick(payload as LoadoutPickMessage, from);
    else if (kind === 'bye') this.handlePeerGone((payload as ByeMessage).peerId);
    else if (kind === 'start' && !this.isHostFlag) this.handleStart(payload as StartMessage);
  }

  // Non-host peers learn the match started from the host's broadcast (the
  // host itself takes the same StartMessage via startMatch()'s direct
  // emitStart() call, since transports never loop a send back to sender).
  private handleStart(msg: StartMessage): void {
    this.started = true;
    this.mode = msg.mode;
    this.roster = msg.roster;
    this.emitStart(msg);
  }

  private handleHello(msg: HelloMessage, from: string): void {
    if (!this.isHostFlag) return; // only the host processes joins
    if (msg.protoVersion !== PROTOCOL_VERSION) {
      const reject: RejectMessage = {
        reason: 'version',
        detail: `protocol v${msg.protoVersion} (joiner) vs v${PROTOCOL_VERSION} (host)`,
      };
      this.transport.send('reject', reject, from);
      return;
    }
    if (BUILD_HASH !== 'dev' && msg.buildHash !== 'dev' && BUILD_HASH !== msg.buildHash) {
      const reject: RejectMessage = { reason: 'version', detail: `build ${msg.buildHash} (joiner) vs ${BUILD_HASH} (host)` };
      this.transport.send('reject', reject, from);
      return;
    }
    if (this.started) {
      this.transport.send('reject', { reason: 'started' } satisfies RejectMessage, from);
      return;
    }
    if (this.roster.length >= MAX_PLAYERS) {
      this.transport.send('reject', { reason: 'full' } satisfies RejectMessage, from);
      return;
    }
    if (this.roster.some((r) => r.peerId === from)) return; // duplicate hello — already joined
    const slot = this.lowestFreeSlot();
    this.roster.push({ peerId: from, slot, name: msg.name, loadout: DEFAULT_NET_LOADOUT });
    this.broadcastLobby();
  }

  private handleLobbyBroadcast(msg: LobbyMessage): void {
    this.hostPeerIdField = msg.hostId;
    this.mode = msg.mode;
    this.roster = msg.roster;
    this.started = msg.started;
    this.emitChange();
  }

  private handleLoadoutPick(msg: LoadoutPickMessage, from: string): void {
    if (!this.isHostFlag) return;
    const entry = this.roster.find((r) => r.peerId === from);
    if (!entry) return;
    entry.loadout = msg.loadout;
    this.broadcastLobby();
  }

  // Fires for both a transport-level peer-leave (crash/tab-close, detected
  // via the transport's own presence mechanism) and an app-level 'bye'
  // message (graceful, explicit leave()) — same handling either way.
  private handlePeerGone(peerId: string): void {
    if (!this.isHostFlag) {
      if (peerId === this.hostPeerIdField) this.emitError({ reason: 'host-left' });
      return; // non-host peers otherwise wait for the host's own rebroadcast
    }
    const idx = this.roster.findIndex((r) => r.peerId === peerId);
    if (idx === -1) return;
    this.roster.splice(idx, 1);
    this.broadcastLobby();
  }

  private lowestFreeSlot(): number {
    const used = new Set(this.roster.map((r) => r.slot));
    for (let slot = 0; slot < MAX_PLAYERS; slot++) if (!used.has(slot)) return slot;
    throw new Error('NetLobby: no free slot (roster.length >= MAX_PLAYERS should have rejected first)');
  }

  private broadcastLobby(): void {
    const msg: LobbyMessage = { hostId: this.transport.selfId, mode: this.mode, roster: [...this.roster], started: this.started };
    this.transport.send('lobby', msg);
    this.emitChange();
  }

  private emitChange(): void {
    for (const l of this.listeners) l();
  }

  private emitError(err: LobbyError): void {
    for (const l of this.errorListeners) l(err);
  }

  private emitStart(msg: StartMessage): void {
    for (const l of this.startListeners) l(msg);
  }
}
