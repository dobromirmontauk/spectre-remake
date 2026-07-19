// The transport abstraction net play is built on: a small pub/sub pipe that
// moves named messages between peers in a "room", plus peer-presence events.
// Implementations: BroadcastChannelTransport (same-origin multi-tab, and the
// default until M4), LoopbackTransport (in-memory bus for same-page
// multi-peer test harnesses), and TrysteroTransport (M4 — real cross-browser
// relays over public WebRTC signaling). sim/ never imports anything from
// net/ — see net/CLAUDE.md for the invariants that depend on that.

export type MessageHandler = (kind: string, payload: unknown, fromPeerId: string) => void;
export type PeerHandler = (peerId: string) => void;
export type Unsubscribe = () => void;

export interface NetTransport {
  // Stable id for this client, assigned at construction (crypto.randomUUID()
  // in the concrete transports below) — never changes across a join/leave.
  readonly selfId: string;

  // Joins the named room. Resolves once the transport is ready to send/
  // receive there; rejects if the join handshake itself times out (a real
  // risk for a relay-based transport like the future TrysteroTransport —
  // moot for BroadcastChannel/Loopback, which have no network round trip at
  // this layer). Resolving does NOT mean a lobby exists in that room —
  // "room not found" is a higher-level concern (net/lobby.ts) detected by
  // the absence of a reply to an application `hello`.
  join(roomCode: string): Promise<void>;

  // Leaves the room and releases transport resources. Safe to call more
  // than once — later calls are no-ops.
  leave(): void;

  // Sends an application message. `to`, if given, restricts delivery to one
  // peer id; implementations still route it through the same broadcast
  // primitive but filter on receive (this is addressing, not confidentiality
  // — matches the `{t:'msg', kind, payload, from, to?}` envelope in the plan).
  send(kind: string, payload: unknown, to?: string): void;

  onMessage(handler: MessageHandler): Unsubscribe;
  onPeerJoin(handler: PeerHandler): Unsubscribe;
  onPeerLeave(handler: PeerHandler): Unsubscribe;
}
