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
import { INPUT_REDUNDANCY, NET_HASH_RING_SIZE } from '../config/constants.ts';
import { packCommand, unpackCommand, type HashMessage, type InputMessage } from './protocol.ts';
import type { NetTransport, Unsubscribe } from './transport.ts';

// How many confirmed ticks of buffered commands to keep behind the
// currently-confirmed tick before pruning — generous margin for
// INPUT_REDUNDANCY resends and any late/reordered packet, bounded so a long
// match doesn't grow the buffers forever.
const PRUNE_MARGIN_TICKS = 90;

export interface LockstepOptions {
  inputDelay: number;
  localSlots: number[]; // slots this client samples local input for (length 1 in M3 — one human per net client)
  liveSlots: number[]; // every slot canStep() waits on; dense, from the match roster
}

export class Lockstep {
  private readonly transport: NetTransport;
  private readonly inputDelay: number;
  private readonly localSlots: number[];
  private readonly liveSlots: number[];
  private readonly buffers = new Map<number, Map<number, Command>>(); // slot -> tick -> Command
  private readonly ownHashes = new Map<number, number>(); // tick -> hash, trimmed to NET_HASH_RING_SIZE
  private readonly pendingPeerHashes = new Map<number, number>(); // tick -> hash, awaiting our own hash at that tick
  private nextTick = 0; // next tick this client hasn't yet handed to the sim
  private lastSampledTick = -1; // last T for which local input was sampled+broadcast
  private desyncTick: number | null = null;
  private desyncHandler: ((tick: number) => void) | null = null;
  private readonly unsubMessage: Unsubscribe;
  private stallSuppressUntil = 0; // debugStallInject(): suppress outbound input broadcast until this performance.now()
  private suppressedGapStartTick: number | null = null; // earliest scheduleTick withheld during the current suppression, for catch-up on resume

  constructor(transport: NetTransport, opts: LockstepOptions) {
    this.transport = transport;
    this.inputDelay = opts.inputDelay;
    this.localSlots = opts.localSlots;
    this.liveSlots = opts.liveSlots;
    for (const slot of this.liveSlots) this.buffers.set(slot, new Map());
    for (let t = 0; t < this.inputDelay; t++) {
      for (const slot of this.liveSlots) this.buffers.get(slot)!.set(t, NEUTRAL_COMMAND);
    }
    this.unsubMessage = transport.onMessage((kind, payload) => {
      if (kind === 'input') this.handleInput(payload as InputMessage);
      else if (kind === 'hash') this.handleHash(payload as HashMessage);
    });
  }

  dispose(): void {
    this.unsubMessage();
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
  // "Waiting for NAME…" overlay text (see net/session.ts).
  missingSlots(tick: number): number[] {
    return this.liveSlots.filter((slot) => !this.buffers.get(slot)!.has(tick));
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
    for (const slot of this.liveSlots) commands[slot] = this.buffers.get(slot)!.get(T)!;
    this.nextTick = T + 1;
    this.pruneBefore(T - PRUNE_MARGIN_TICKS);
    return commands;
  }

  // Called by the session once per HASH_INTERVAL_TICKS after a successful
  // step (see net/session.ts NetSession.afterTick) — records our own hash,
  // broadcasts it, and compares against any peer hash already received for
  // this tick (or waits for one to arrive and compares then).
  recordAndBroadcastHash(tick: number, hash: number): void {
    this.ownHashes.set(tick, hash);
    this.trimOwnHashes();
    const pending = this.pendingPeerHashes.get(tick);
    if (pending !== undefined) {
      this.pendingPeerHashes.delete(tick);
      if (pending !== hash) this.raiseDesync(tick);
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
    for (let i = 0; i < msg.cmds.length; i++) {
      const tick = msg.firstTick + i;
      if (tick < 0) continue;
      this.setCommand(msg.slot, tick, unpackCommand(msg.cmds[i]!));
    }
  }

  private handleHash(msg: HashMessage): void {
    const own = this.ownHashes.get(msg.tick);
    if (own === undefined) {
      this.pendingPeerHashes.set(msg.tick, msg.hash);
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
