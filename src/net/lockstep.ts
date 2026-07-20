// Delayed-input lockstep: buffers local + remote commands per (slot, tick),
// gates the sim's accumulator loop via canStep(), and exchanges periodic
// state hashes to detect desync. See the plan's Design §3.3-3.6 and
// net/CLAUDE.md for the invariants this depends on (every peer runs the
// identical step()/handleEvents()/tick() sequence for a given tick number).
//
// Every net client samples its own local input once per distinct tick it's
// trying to schedule — not once per frame, since the session may call
// commandsForNextTick() several times while stalled without resampling —
// and assigns it to tick T + NET_INPUT_DELAY_TICKS, buffering it locally and
// broadcasting an `input` packet that redundantly resends the last
// INPUT_REDUNDANCY ticks (belt-and-suspenders over a reliable-ordered
// BroadcastChannel/DataChannel, not load-bearing, but cheap). Ticks
// 0..D-1 are pre-seeded NEUTRAL for every live slot so a match can start
// stepping immediately without waiting for the first real input round trip.

import type { Command } from '../sim/commands.ts';
import { NEUTRAL_COMMAND } from '../sim/commands.ts';
import { DISCONNECT_GRACE_TICKS, INPUT_REDUNDANCY, NET_HASH_RING_SIZE, SIM_HZ, ZOMBIE_TIMEOUT_MS } from '../config/constants.ts';
import { packCommand, unpackCommand, type DropMessage, type HashMessage, type InputMessage } from './protocol.ts';
import type { NetTransport, Unsubscribe } from './transport.ts';

// How many confirmed ticks of buffered commands to keep behind the
// currently-confirmed tick before pruning — generous margin for
// INPUT_REDUNDANCY resends and any late/reordered packet, bounded so a long
// match doesn't grow the buffers forever.
const PRUNE_MARGIN_TICKS = 90;

// DISCONNECT_GRACE_TICKS is expressed in ticks (config/constants.ts, so it
// reads next to the other tick-based tunables) but the grace timer itself
// MUST be wall-clock (see checkHostDisconnects below) — converted once here.
const DISCONNECT_GRACE_MS = (DISCONNECT_GRACE_TICKS / SIM_HZ) * 1000;

export interface LockstepOptions {
  inputDelay: number;
  localSlots: number[]; // slots this client samples local input for (length 1 in M3 — one human per net client)
  liveSlots: number[]; // every slot canStep() waits on; dense, from the match roster
  // M5 disconnect protocol: only the host originates grace-timer/zombie drop
  // decisions (see checkHostDisconnects); `roster` maps a transport
  // peer-leave's peerId back to the roster slot it owns.
  isHost: boolean;
  roster: { slot: number; peerId: string }[];
}

export class Lockstep {
  private readonly transport: NetTransport;
  private readonly inputDelay: number;
  private readonly localSlots: number[];
  private readonly liveSlots: number[];
  private readonly isHost: boolean;
  private readonly rosterSlotByPeer = new Map<string, number>();
  private readonly buffers = new Map<number, Map<number, Command>>(); // slot -> tick -> Command
  private readonly ownHashes = new Map<number, number>(); // tick -> hash, trimmed to NET_HASH_RING_SIZE
  // tick -> peerId -> hash, awaiting our own hash at that tick. MUST be keyed
  // per-peer, not just per-tick: with 3+ players every peer receives a `hash`
  // from EACH other peer for the same tick, and a single tick-keyed slot
  // would let one peer's hash silently clobber another's before ours arrives
  // to compare against it — a real bug found under 3-player testing (M5),
  // never exercised by M3/M4's 2-peer-only verification.
  private readonly pendingPeerHashes = new Map<number, Map<string, number>>();
  private nextTick = 0; // next tick this client hasn't yet handed to the sim
  private lastProcessedTick = -1; // last T actually consumed by commandsForNextTick (see takeDueDrops)
  private lastSampledTick = -1; // last T for which local input was sampled+broadcast
  private desyncTick: number | null = null;
  private desyncHandler: ((tick: number) => void) | null = null;
  private readonly unsubMessage: Unsubscribe;
  private readonly unsubPeerLeave: Unsubscribe;
  private stallSuppressUntil = 0; // debugStallInject(): suppress outbound input broadcast until this performance.now()
  private suppressedGapStartTick: number | null = null; // earliest scheduleTick withheld during the current suppression, for catch-up on resume

  // --- M5 disconnect protocol (net/CLAUDE.md "Disconnect robustness") ---
  // A slot whose commands default to NEUTRAL_COMMAND instead of blocking
  // canStep() — either because its peer's transport connection genuinely
  // dropped (handleTransportPeerLeave), or because we've received/originated
  // an authoritative `drop` for it (scheduleDrop). This MUST happen the
  // instant we learn a slot is gone, independent of tick progress — a silent
  // peer would otherwise deadlock every peer's canStep() forever (nobody can
  // advance to the tick that would apply the eventual drop).
  private readonly orphanedSlots = new Set<number>();
  // A slot removePlayer() has actually been applied for (see takeDueDrops) —
  // fully excluded from missingSlots/commandsForNextTick from then on.
  private readonly droppedSlots = new Set<number>();
  private readonly pendingDrops = new Map<number, number>(); // slot -> effectiveTick, received (or self-originated) but not yet reached
  private readonly lastInputAtMs = new Map<number, number>(); // slot -> wall-clock time of its last received `input` (host-side zombie check)
  private readonly peerLeftAtMs = new Map<number, number>(); // slot -> wall-clock time its transport peer-leave was detected (host-side grace timer)

  constructor(transport: NetTransport, opts: LockstepOptions) {
    this.transport = transport;
    this.inputDelay = opts.inputDelay;
    this.localSlots = opts.localSlots;
    this.liveSlots = opts.liveSlots;
    this.isHost = opts.isHost;
    for (const r of opts.roster) this.rosterSlotByPeer.set(r.peerId, r.slot);
    for (const slot of this.liveSlots) this.buffers.set(slot, new Map());
    for (let t = 0; t < this.inputDelay; t++) {
      for (const slot of this.liveSlots) this.buffers.get(slot)!.set(t, NEUTRAL_COMMAND);
    }
    const now = performance.now();
    for (const slot of this.liveSlots) this.lastInputAtMs.set(slot, now);
    this.unsubMessage = transport.onMessage((kind, payload, from) => {
      if (kind === 'input') this.handleInput(payload as InputMessage);
      else if (kind === 'hash') this.handleHash(payload as HashMessage, from);
      else if (kind === 'drop') this.handleDropMessage(payload as DropMessage);
    });
    this.unsubPeerLeave = transport.onPeerLeave((peerId) => this.handleTransportPeerLeave(peerId));
  }

  dispose(): void {
    this.unsubMessage();
    this.unsubPeerLeave();
  }

  onDesync(handler: (tick: number) => void): void {
    this.desyncHandler = handler;
  }

  // Ticks [0, confirmedTick) have been handed to the sim on this client.
  get confirmedTick(): number {
    return this.nextTick;
  }

  hashAtTick(tick: number): number | undefined {
    return this.ownHashes.get(tick);
  }

  // Debug-only (see game/debug.ts __game.net.debugStallInject): suppresses
  // this client's outbound `input` broadcast for `ms` wall-clock
  // milliseconds, so a peer's canStep() starves waiting on this slot — used
  // to verify the stall overlay and recovery without a real network
  // partition. Local buffering/sampling still happens; only the broadcast
  // is withheld, and withheld ticks are caught up in one wider packet the
  // moment the suppression window ends (see broadcastInput) — otherwise any
  // tick whose entire INPUT_REDUNDANCY resend window fell inside the
  // suppressed period would never reach the peer at all, turning a
  // transient debug stall into a permanent one.
  debugStallInject(ms: number): void {
    this.stallSuppressUntil = performance.now() + ms;
  }

  canStep(tick: number): boolean {
    return this.missingSlots(tick).length === 0;
  }

  // Slots canStep() is currently blocked on for `tick` — drives the
  // "Waiting for NAME…" overlay text (see net/session.ts). An orphaned or
  // fully-dropped slot never blocks (see the M5 disconnect-protocol fields
  // above) — its command defaults to NEUTRAL_COMMAND instead.
  missingSlots(tick: number): number[] {
    return this.liveSlots.filter((slot) => !this.orphanedSlots.has(slot) && !this.droppedSlots.has(slot) && !this.buffers.get(slot)!.has(tick));
  }

  // Returns this tick's command-by-slot map and advances, or null if any
  // live slot hasn't produced its command for this tick yet (the
  // accumulator freezes — see net/session.ts's commandsForNextTick).
  // `readLocalCommand` samples the local input source exactly once per
  // distinct tick attempted, not once per stalled retry — but the broadcast
  // itself is retried on every call regardless (see broadcastInput): while
  // stalled, T stays frozen and app.ts still polls this once per frame, so
  // retrying the send each time is what lets a transient withheld broadcast
  // (debugStallInject, or a real hiccup) catch up the moment it clears,
  // rather than getting a single shot at the moment of sampling.
  commandsForNextTick(readLocalCommand: (slot: number) => Command): Record<number, Command> | null {
    // Host-only disconnect bookkeeping (M5) — MUST run on every call, not
    // just once a tick actually advances: while a slot is silent, canStep()
    // below can stay false indefinitely, and this is the only thing that
    // ever clears that (see checkHostDisconnects' doc comment). app.ts calls
    // commandsForNextTick() at least once per rendered frame regardless of
    // whether the sim is stalled, so this still runs during a stall.
    if (this.isHost) this.checkHostDisconnects();

    const T = this.nextTick;
    const scheduleTick = T + this.inputDelay;
    if (this.lastSampledTick < T) {
      for (const slot of this.localSlots) {
        this.setCommand(slot, scheduleTick, readLocalCommand(slot));
      }
      this.lastSampledTick = T;
    }
    this.broadcastInput(scheduleTick);
    if (!this.canStep(T)) return null;
    const commands: Record<number, Command> = {};
    for (const slot of this.liveSlots) {
      if (this.droppedSlots.has(slot)) continue; // fully removed — sim already skips a !alive tank's command lookup
      commands[slot] = this.buffers.get(slot)!.get(T) ?? NEUTRAL_COMMAND; // orphaned slot (or any gap) fills neutral
    }
    this.lastProcessedTick = T;
    this.nextTick = T + 1;
    this.pruneBefore(T - PRUNE_MARGIN_TICKS);
    return commands;
  }

  // Slots to apply sim/simulation.ts removePlayer() to at the tick just
  // consumed by commandsForNextTick() (see net/session.ts NetSession.dueDrops
  // and net/CLAUDE.md's drop-application invariant) — called once per
  // successful (non-null) commandsForNextTick() result, before step() runs
  // that tick. Idempotent: a slot is only ever returned once, the moment its
  // pending drop's effectiveTick is reached.
  takeDueDrops(): number[] {
    const tick = this.lastProcessedTick;
    const due: number[] = [];
    for (const [slot, effectiveTick] of [...this.pendingDrops]) {
      if (effectiveTick > tick) continue;
      due.push(slot);
      this.pendingDrops.delete(slot);
      this.droppedSlots.add(slot);
    }
    return due;
  }

  get latestScheduledTick(): number {
    return this.nextTick + this.inputDelay;
  }

  // A roster peer's transport connection genuinely dropped (crash/tab-close —
  // see broadcast.ts/trystero.ts onPeerLeave). Every peer (not just the
  // host) stops waiting on that slot's real input immediately — otherwise
  // the whole match freezes the instant one peer's connection drops. Only
  // the host additionally arms a DISCONNECT_GRACE_TICKS wall-clock timer
  // (checkHostDisconnects) to actually remove the player.
  private handleTransportPeerLeave(peerId: string): void {
    const slot = this.rosterSlotByPeer.get(peerId);
    if (slot === undefined || this.droppedSlots.has(slot) || this.orphanedSlots.has(slot)) return;
    this.orphanedSlots.add(slot);
    if (this.isHost) this.peerLeftAtMs.set(slot, performance.now());
  }

  private handleDropMessage(msg: DropMessage): void {
    this.scheduleDrop(msg.slot, msg.effectiveTick);
  }

  // Records a pending drop, whether it arrived over the wire or was just
  // originated locally by the host (see broadcastDrop) — always marks the
  // slot orphaned too, since a `drop` message is by itself sufficient
  // evidence the slot is gone even on a peer that never independently
  // detected a transport-level leave for it (the host-side zombie path: a
  // silently-stalled peer's connection never actually closes, so non-host
  // peers have no signal of their own — the `drop` message IS the signal).
  private scheduleDrop(slot: number, effectiveTick: number): void {
    if (this.droppedSlots.has(slot) || this.pendingDrops.has(slot)) return;
    this.orphanedSlots.add(slot);
    this.pendingDrops.set(slot, effectiveTick);
  }

  // Host-only: originates an authoritative drop — broadcasts it AND applies
  // scheduleDrop() locally (transports never loop a send back to their own
  // sender — see net/CLAUDE.md — so the host takes the identical path as
  // every joiner, same pattern as NetLobby.startMatch()). effectiveTick uses
  // the same "current schedule tick + inputDelay" lead time a normal input
  // packet gets, so every peer's `drop` handling has time to arrive and
  // orphan the slot before their own sim reaches that tick.
  private broadcastDrop(slot: number, effectiveTick: number): void {
    const msg: DropMessage = { slot, effectiveTick };
    this.transport.send('drop', msg);
    this.scheduleDrop(slot, effectiveTick);
  }

  // Host-only bookkeeping, called on every commandsForNextTick() (i.e. every
  // rendered frame, even mid-stall — see that method's doc comment): (a) a
  // slot whose transport peer-leave grace period has elapsed with no
  // reconnect support to save it — this always fires after
  // DISCONNECT_GRACE_TICKS, the delay exists purely so the tank doesn't
  // vanish instantly; (b) a "zombie" slot — transport still reports the
  // peer connected, but no `input` packet has arrived from it in
  // ZOMBIE_TIMEOUT_MS (see __game.net.debugStallInject) — dropped
  // immediately, no additional grace on top of the timeout already waited.
  private checkHostDisconnects(): void {
    const nowMs = performance.now();

    for (const [slot, leftAt] of [...this.peerLeftAtMs]) {
      if (this.droppedSlots.has(slot) || this.pendingDrops.has(slot)) {
        this.peerLeftAtMs.delete(slot);
        continue;
      }
      if (nowMs - leftAt < DISCONNECT_GRACE_MS) continue;
      this.peerLeftAtMs.delete(slot);
      this.broadcastDrop(slot, this.latestScheduledTick);
    }

    for (const slot of this.liveSlots) {
      if (this.localSlots.includes(slot)) continue; // never zombie-check ourselves
      if (this.droppedSlots.has(slot) || this.pendingDrops.has(slot) || this.orphanedSlots.has(slot)) continue;
      const lastSeen = this.lastInputAtMs.get(slot);
      if (lastSeen === undefined || nowMs - lastSeen < ZOMBIE_TIMEOUT_MS) continue;
      this.broadcastDrop(slot, this.latestScheduledTick);
    }
  }

  // Called by the session once per HASH_INTERVAL_TICKS after a successful
  // step (see net/session.ts NetSession.afterTick) — records our own hash,
  // broadcasts it, and compares against EVERY peer hash already received for
  // this tick (one per other peer — see pendingPeerHashes' doc comment; a
  // 3+ player match means more than one may already be waiting).
  recordAndBroadcastHash(tick: number, hash: number): void {
    this.ownHashes.set(tick, hash);
    this.trimOwnHashes();
    const pending = this.pendingPeerHashes.get(tick);
    if (pending !== undefined) {
      this.pendingPeerHashes.delete(tick);
      for (const peerHash of pending.values()) {
        if (peerHash !== hash) {
          this.raiseDesync(tick);
          break;
        }
      }
    }
    const msg: HashMessage = { tick, hash };
    this.transport.send('hash', msg);
  }

  private raiseDesync(tick: number): void {
    if (this.desyncTick !== null) return;
    this.desyncTick = tick;
    this.desyncHandler?.(tick);
  }

  private handleInput(msg: InputMessage): void {
    this.lastInputAtMs.set(msg.slot, performance.now()); // host-side zombie-timeout tracking (checkHostDisconnects)
    for (let i = 0; i < msg.cmds.length; i++) {
      const tick = msg.firstTick + i;
      if (tick < 0) continue;
      this.setCommand(msg.slot, tick, unpackCommand(msg.cmds[i]!));
    }
  }

  private handleHash(msg: HashMessage, fromPeerId: string): void {
    const own = this.ownHashes.get(msg.tick);
    if (own === undefined) {
      let bucket = this.pendingPeerHashes.get(msg.tick);
      if (!bucket) {
        bucket = new Map();
        this.pendingPeerHashes.set(msg.tick, bucket);
      }
      bucket.set(fromPeerId, msg.hash);
      return;
    }
    if (own !== msg.hash) this.raiseDesync(msg.tick);
  }

  private setCommand(slot: number, tick: number, cmd: Command): void {
    let bySlot = this.buffers.get(slot);
    if (!bySlot) {
      bySlot = new Map();
      this.buffers.set(slot, bySlot);
    }
    bySlot.set(tick, cmd);
  }

  private broadcastInput(scheduleTick: number): void {
    if (performance.now() < this.stallSuppressUntil) {
      if (this.suppressedGapStartTick === null) this.suppressedGapStartTick = scheduleTick;
      return;
    }
    // If we just came out of a suppressed window, widen this one packet to
    // cover the whole gap (rather than the usual last INPUT_REDUNDANCY
    // ticks) so nothing withheld during the suppression is lost for good.
    const gapStart = this.suppressedGapStartTick;
    this.suppressedGapStartTick = null;
    const firstTick = gapStart !== null ? Math.max(0, gapStart) : Math.max(0, scheduleTick - INPUT_REDUNDANCY + 1);
    for (const slot of this.localSlots) {
      const bySlot = this.buffers.get(slot);
      if (!bySlot) continue;
      const cmds: number[] = [];
      for (let t = firstTick; t <= scheduleTick; t++) {
        cmds.push(packCommand(bySlot.get(t) ?? NEUTRAL_COMMAND));
      }
      const msg: InputMessage = { slot, firstTick, cmds };
      this.transport.send('input', msg);
    }
  }

  private trimOwnHashes(): void {
    while (this.ownHashes.size > NET_HASH_RING_SIZE) {
      let oldest = Infinity;
      for (const t of this.ownHashes.keys()) if (t < oldest) oldest = t;
      this.ownHashes.delete(oldest);
    }
  }

  private pruneBefore(tick: number): void {
    if (tick <= 0) return;
    for (const bySlot of this.buffers.values()) {
      for (const t of bySlot.keys()) if (t < tick) bySlot.delete(t);
    }
  }
}
