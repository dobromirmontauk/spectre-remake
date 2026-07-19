// Same-origin transport over the browser's BroadcastChannel API — every tab/
// window joining the same room code shares one channel. Two-tab local play
// and the default net-play transport until TrysteroTransport (M4) lands.
// Note: BroadcastChannel does NOT cross Playwright browser *contexts* —
// automated two-peer tests must use two pages in ONE context (net/CLAUDE.md).
//
// BroadcastChannel has no built-in peer discovery, so this transport layers
// a tiny presence protocol on the same channel: a joiner broadcasts 'hello',
// every existing peer replies with 'here' (so the joiner learns who else is
// present, and everyone fires onPeerJoin for the new arrival), and
// leave()/pagehide broadcast 'bye'. Application messages ride the same
// channel wrapped as {t:'msg', kind, payload, from, to?}; `to`, if set, is
// filtered on receive (BroadcastChannel itself has no concept of unicast).

import type { MessageHandler, NetTransport, PeerHandler, Unsubscribe } from './transport.ts';

type Envelope =
  | { t: 'hello'; from: string }
  | { t: 'here'; from: string }
  | { t: 'bye'; from: string }
  | { t: 'msg'; kind: string; payload: unknown; from: string; to?: string };

export class BroadcastChannelTransport implements NetTransport {
  readonly selfId = crypto.randomUUID();

  private channel: BroadcastChannel | null = null;
  private readonly knownPeers = new Set<string>();
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly joinHandlers = new Set<PeerHandler>();
  private readonly leaveHandlers = new Set<PeerHandler>();
  private readonly onPageHide = (): void => this.leave();

  async join(roomCode: string): Promise<void> {
    this.channel = new BroadcastChannel(`spectre-room-${roomCode}`);
    this.channel.addEventListener('message', this.onChannelMessage);
    window.addEventListener('pagehide', this.onPageHide);
    this.post({ t: 'hello', from: this.selfId });
    // No handshake round trip to wait on at this layer (see transport.ts) —
    // resolve as soon as the channel is open and the announcement is sent.
  }

  leave(): void {
    if (!this.channel) return;
    this.post({ t: 'bye', from: this.selfId });
    this.channel.removeEventListener('message', this.onChannelMessage);
    this.channel.close();
    this.channel = null;
    this.knownPeers.clear();
    window.removeEventListener('pagehide', this.onPageHide);
  }

  send(kind: string, payload: unknown, to?: string): void {
    this.post({ t: 'msg', kind, payload, from: this.selfId, to });
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

  private post(envelope: Envelope): void {
    this.channel?.postMessage(envelope);
  }

  private readonly onChannelMessage = (ev: MessageEvent<Envelope>): void => {
    const envelope = ev.data;
    if (!envelope || envelope.from === this.selfId) return; // BroadcastChannel never loops back to the sender, but guard anyway
    if (envelope.t === 'hello') {
      this.post({ t: 'here', from: this.selfId }); // let the new peer discover us
      this.addPeer(envelope.from);
    } else if (envelope.t === 'here') {
      this.addPeer(envelope.from);
    } else if (envelope.t === 'bye') {
      this.removePeer(envelope.from);
    } else if (envelope.t === 'msg') {
      if (envelope.to && envelope.to !== this.selfId) return;
      for (const handler of this.messageHandlers) handler(envelope.kind, envelope.payload, envelope.from);
    }
  };

  private addPeer(peerId: string): void {
    if (this.knownPeers.has(peerId)) return;
    this.knownPeers.add(peerId);
    for (const handler of this.joinHandlers) handler(peerId);
  }

  private removePeer(peerId: string): void {
    if (!this.knownPeers.delete(peerId)) return;
    for (const handler of this.leaveHandlers) handler(peerId);
  }
}
