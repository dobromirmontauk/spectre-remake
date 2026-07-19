// Real cross-browser transport (M4): WebRTC DataChannels between browsers,
// signaled over the public Nostr relay network — nothing the user runs or
// deploys. Nostr strategy chosen per the plan (many public relays, plain
// WebSocket signaling); the `trystero/nostr` import is the only
// strategy-specific line in this file, so switching to `trystero/torrent`
// later is a one-line change.
//
// The trystero runtime is loaded via a *dynamic* import inside join() only
// — never at module load — so opening the base game (no Net Play) never
// pays for the WebRTC/relay bundle; see createTransport.ts and net/CLAUDE.md.
//
// Trystero action namespaces have a byte-length limit (32 bytes in the
// installed version; historically as low as 12 in older releases). Every
// NetMessageKind (net/protocol.ts) is <=11 ASCII chars, so this file maps
// each kind straight to an action namespace of the same name — no
// truncation/remapping table needed, just NET_MESSAGE_KINDS iterated once.

import type { MessageHandler, NetTransport, PeerHandler, Unsubscribe } from './transport.ts';
import { NET_JOIN_TIMEOUT_MS, TRYSTERO_APP_ID, TRYSTERO_RELAY_URLS } from '../config/constants.ts';
import { NET_MESSAGE_KINDS, type NetMessageKind } from './protocol.ts';

// A small structural subset of trystero's real Room/joinRoom types (see
// node_modules/@trystero-p2p/core/dist/types.d.mts) — kept local rather than
// imported so this file documents exactly what it relies on, and so the
// (dynamically-imported-only) trystero types never need to be resolved for
// a static import elsewhere. `getRelaySockets` is genuinely untyped (`any`)
// in trystero's own .d.mts — it's an escape hatch for relay connection
// state, not part of the documented public API.
interface TrysteroAction {
  send(data: unknown, options?: { target?: string | string[] | null }): Promise<void>;
  onMessage: ((data: unknown, context: { peerId: string }) => void) | null;
}
interface TrysteroRoom {
  makeAction(namespace: string): TrysteroAction;
  leave(): Promise<void>;
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
}
interface TrysteroModule {
  joinRoom(
    config: { appId: string; relayConfig?: { urls?: string[] } },
    roomId: string,
    callbacks?: { onJoinError?: (details: { error: string; appId: string; roomId: string; peerId: string }) => void },
  ): TrysteroRoom;
  getRelaySockets(): Record<string, WebSocket>;
  readonly selfId: string;
}

interface PendingSend {
  kind: NetMessageKind;
  payload: unknown;
  to: string | undefined;
}

export class TrysteroTransport implements NetTransport {
  private _selfId = '';
  private room: TrysteroRoom | null = null;
  private readonly actions = new Map<NetMessageKind, TrysteroAction>();
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly joinHandlers = new Set<PeerHandler>();
  private readonly leaveHandlers = new Set<PeerHandler>();
  // Peers trystero itself considers "active" (WebRTC connected AND past its
  // own internal handshake — see @trystero-p2p/core's handshake.mjs). A
  // real risk unique to this transport (moot for BroadcastChannel/Loopback,
  // which have no connection-setup latency): net/lobby.ts sends its `hello`
  // the instant transport.join() resolves, but join() here only means "a
  // relay is reachable" (see waitForRelay() below) — the actual peer-to-peer
  // connection to the host is still being negotiated at that moment, so
  // trystero's own action.send() would silently deliver to zero peers and
  // drop it for good. pendingSends queues anything sent while its target(s)
  // aren't active yet and replays it once a peer activates.
  private readonly activePeers = new Set<string>();
  private readonly pendingSends: PendingSend[] = [];

  // Not known until join() dynamically imports trystero and reads its
  // (page-lifetime-stable) selfId — see the getter below. Every caller in
  // net/lobby.ts only reads .selfId after join()/host() has resolved (it's
  // used to stamp outgoing hello/roster entries), so this is never observed
  // in its pre-join '' state.
  get selfId(): string {
    return this._selfId;
  }

  async join(roomCode: string): Promise<void> {
    const trystero = (await import('trystero/nostr')) as unknown as TrysteroModule;
    this._selfId = trystero.selfId;

    const room = trystero.joinRoom({ appId: TRYSTERO_APP_ID, relayConfig: { urls: TRYSTERO_RELAY_URLS } }, roomCode, {
      // trystero's own per-peer handshake failures (distinct from this
      // file's relay-reachability check below) would otherwise fail
      // silently — surface them for debuggability (see net/CLAUDE.md's
      // "confusion is debuggable" goal for the transport layer).
      onJoinError: (details) => console.warn('TrysteroTransport: peer join error', details),
    });
    this.room = room;

    room.onPeerJoin = (peerId) => {
      this.activePeers.add(peerId);
      for (const h of this.joinHandlers) h(peerId);
      this.flushPendingSends();
    };
    room.onPeerLeave = (peerId) => {
      this.activePeers.delete(peerId);
      for (const h of this.leaveHandlers) h(peerId);
    };

    for (const kind of NET_MESSAGE_KINDS) {
      const action = room.makeAction(kind);
      action.onMessage = (data, context) => {
        for (const h of this.messageHandlers) h(kind, data, context.peerId);
      };
      this.actions.set(kind, action);
    }

    try {
      await this.waitForRelay(() => trystero.getRelaySockets());
    } catch (err) {
      this.room = null;
      this.actions.clear();
      room.leave().catch(() => {});
      throw err;
    }
  }

  leave(): void {
    const room = this.room;
    if (!room) return;
    this.room = null;
    this.actions.clear();
    this.activePeers.clear();
    this.pendingSends.length = 0;
    room.leave().catch(() => {});
  }

  send(kind: string, payload: unknown, to?: string): void {
    const netKind = kind as NetMessageKind;
    const action = this.actions.get(netKind);
    if (!action) return;
    const hasActiveTarget = to ? this.activePeers.has(to) : this.activePeers.size > 0;
    if (!hasActiveTarget) {
      // Nobody it could reach is active yet — see pendingSends' comment
      // above. Queue it; flushPendingSends() re-runs it through this same
      // method once a peer activates (so a still-not-yet-active `to` just
      // re-queues itself again, harmlessly).
      this.pendingSends.push({ kind: netKind, payload, to });
      return;
    }
    action.send(payload, to ? { target: to } : undefined).catch(() => {
      // A mid-send peer drop surfaces through the presence layer
      // (onPeerLeave) or the next lockstep retry (net/lockstep.ts) — no
      // separate handling needed here.
    });
  }

  private flushPendingSends(): void {
    if (this.pendingSends.length === 0) return;
    const queued = this.pendingSends.splice(0);
    for (const { kind, payload, to } of queued) this.send(kind, payload, to);
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onPeerJoin(handler: PeerHandler): Unsubscribe {
    this.joinHandlers.add(handler);
    return () => this.joinHandlers.delete(handler);
  }

  onPeerLeave(handler: PeerHandler): Unsubscribe {
    this.leaveHandlers.add(handler);
    return () => this.leaveHandlers.delete(handler);
  }

  // Resolves once at least one pinned relay's WebSocket is open (ready to
  // carry signaling); rejects after NET_JOIN_TIMEOUT_MS otherwise — this is
  // "relay unreachable" (net/lobby.ts's LobbyErrorReason), distinct from
  // NET_ROOM_NOT_FOUND_TIMEOUT_MS in lobby.ts's own join(), which only
  // starts counting once the relay mesh IS reachable but no host answers
  // `hello`. Every pinned relay's WebSocket is constructed synchronously
  // inside trystero.joinRoom() (registered the moment the strategy first
  // initializes — see @trystero-p2p/core's strategy.mjs/topic-strategy.mjs),
  // so by the time this runs the sockets already exist; only their
  // readyState is still pending.
  private waitForRelay(getRelaySockets: () => Record<string, WebSocket>): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanups: Array<() => void> = [];
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        for (const cleanup of cleanups) cleanup();
        if (ok) resolve();
        else reject(new Error('relay unreachable'));
      };
      const timer = window.setTimeout(() => finish(false), NET_JOIN_TIMEOUT_MS);
      const sockets = Object.values(getRelaySockets());
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) {
          finish(true);
          return;
        }
        const onOpen = (): void => finish(true);
        socket.addEventListener('open', onOpen);
        cleanups.push(() => socket.removeEventListener('open', onOpen));
      }
      if (sockets.length === 0) finish(false); // no relays registered — shouldn't happen with TRYSTERO_RELAY_URLS set
    });
  }
}
