// In-memory transport for driving several peers from one page — no
// BroadcastChannel/network involved. Used by the M5 8-peer test harness and
// handy for unit-testing net/lobby.ts without a real browser message
// channel. A static registry of "buses" keyed by room code stands in for the
// room; every LoopbackTransport that joins the same code shares the same bus
// and receives other members' messages/presence via queueMicrotask (so
// ordering behaves like a real async transport, not same-tick reentrancy).

import type { MessageHandler, NetTransport, PeerHandler, Unsubscribe } from './transport.ts';

interface Bus {
  members: Map<string, LoopbackTransport>;
}

const registry = new Map<string, Bus>();

function busFor(roomCode: string): Bus {
  let bus = registry.get(roomCode);
  if (!bus) {
    bus = { members: new Map() };
    registry.set(roomCode, bus);
  }
  return bus;
}

export class LoopbackTransport implements NetTransport {
  readonly selfId: string;

  private bus: Bus | null = null;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly joinHandlers = new Set<PeerHandler>();
  private readonly leaveHandlers = new Set<PeerHandler>();

  constructor(selfId?: string) {
    this.selfId = selfId ?? crypto.randomUUID();
  }

  async join(roomCode: string): Promise<void> {
    const bus = busFor(roomCode);
    // Announce to existing members, and learn about them, before adding
    // ourselves to the bus — so nobody (including this transport) fires
    // onPeerJoin about itself.
    for (const other of bus.members.values()) {
      queueMicrotask(() => {
        for (const h of other.joinHandlers) h(this.selfId);
        for (const h of this.joinHandlers) h(other.selfId);
      });
    }
    bus.members.set(this.selfId, this);
    this.bus = bus;
  }

  leave(): void {
    const bus = this.bus;
    if (!bus) return;
    bus.members.delete(this.selfId);
    for (const other of bus.members.values()) {
      queueMicrotask(() => {
        for (const h of other.leaveHandlers) h(this.selfId);
      });
    }
    if (bus.members.size === 0) {
      for (const [code, candidate] of registry) if (candidate === bus) registry.delete(code);
    }
    this.bus = null;
  }

  send(kind: string, payload: unknown, to?: string): void {
    const bus = this.bus;
    if (!bus) return;
    for (const member of bus.members.values()) {
      if (member.selfId === this.selfId) continue;
      if (to && member.selfId !== to) continue;
      queueMicrotask(() => member.dispatch(kind, payload, this.selfId));
    }
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

  private dispatch(kind: string, payload: unknown, from: string): void {
    for (const handler of this.messageHandlers) handler(kind, payload, from);
  }
}
