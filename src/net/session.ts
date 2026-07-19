// PlaySession abstraction (plan §3.6): decouples game/app.ts's fixed-
// timestep accumulator loop from where each tick's commands come from.
// LocalSession reproduces the pre-M3 behavior exactly (including the debug
// commandOverride path used by Playwright's pressCommand hook); NetSession
// sources every slot's command from net/lockstep.ts, buffering local
// keyboard input the same way today's keyboard.readCommand() does but
// gated by canStep() so every peer runs the identical `commands` map for a
// given tick (see net/CLAUDE.md's tick-sequence invariant).

import { HASH_INTERVAL_TICKS } from '../config/constants.ts';
import { hashState } from '../sim/hash.ts';
import type { Command } from '../sim/commands.ts';
import { NEUTRAL_COMMAND } from '../sim/commands.ts';
import { playerIdForSlot } from '../sim/simulation.ts';
import type { GameState } from '../sim/types.ts';
import type { KeyboardInput } from '../input/keyboard.ts';
import { Lockstep } from './lockstep.ts';
import type { RosterEntry } from './protocol.ts';
import type { NetTransport, Unsubscribe } from './transport.ts';

export interface PlaySession {
  readonly kind: 'local' | 'net';
  // Returns this tick's commands keyed by tank id, or null if the session
  // isn't ready to advance yet (net play only — a live slot's command
  // hasn't arrived; the accumulator loop must freeze, not skip a tick).
  commandsForNextTick(): Record<string, Command> | null;
  // Player slots this client renders/controls a camera for — [0] in solo
  // and net play (net always renders one viewport, following the local
  // player, per plan §3), [0,1] in local split-screen 2P.
  localSlots(): number[];
  isPauseAllowed(): boolean;
  // Debug hook plumbing (window.__game.pressCommand/fire) — overrides local
  // input for `ticks` ticks. Routed through here so both sessions expose the
  // same deterministic test surface.
  pressCommand(cmd: Partial<Command>, ticks: number): void;
  // Called once per confirmed tick, right after step()->handleEvents()->
  // tick() — NetSession uses it to exchange hashes; LocalSession no-ops.
  // Never mutates `state` (see net/CLAUDE.md's purity invariant).
  afterTick(state: GameState): void;
  // Names currently blocking this tick from advancing (net only, empty
  // otherwise) — drives the "Waiting for NAME…" stall overlay.
  missingNames(): string[];
  dispose(): void;
}

// --- Local (solo / local 2P) ---

export class LocalSession implements PlaySession {
  readonly kind = 'local' as const;
  private readonly state: GameState;
  private readonly keyboard: KeyboardInput;
  private commandOverride: { command: Command; ticksRemaining: number } | null = null;

  constructor(state: GameState, keyboard: KeyboardInput) {
    this.state = state;
    this.keyboard = keyboard;
  }

  localSlots(): number[] {
    return this.state.players.length > 1 ? [0, 1] : [0];
  }

  isPauseAllowed(): boolean {
    return true;
  }

  pressCommand(cmd: Partial<Command>, ticks: number): void {
    this.commandOverride = { command: { ...NEUTRAL_COMMAND, ...cmd }, ticksRemaining: ticks };
  }

  private resolveP1(): Command {
    if (this.commandOverride) {
      const cmd = this.commandOverride.command;
      this.commandOverride.ticksRemaining--;
      if (this.commandOverride.ticksRemaining <= 0) this.commandOverride = null;
      return cmd;
    }
    return this.keyboard.readCommand();
  }

  commandsForNextTick(): Record<string, Command> {
    const commands: Record<string, Command> = {};
    const [p0, p1] = this.state.players;
    if (p0) commands[p0.id] = this.resolveP1();
    if (p1) commands[p1.id] = this.keyboard.readCommand2();
    return commands;
  }

  afterTick(): void {
    // no-op — nothing to exchange in local play
  }

  missingNames(): string[] {
    return [];
  }

  dispose(): void {
    // no owned resources
  }
}

// --- Net ---

export interface NetSessionOptions {
  transport: NetTransport;
  roster: RosterEntry[]; // host-assigned slots, need not be sorted
  selfPeerId: string;
  keyboard: KeyboardInput;
  inputDelay: number;
  onDesync: (tick: number) => void;
  onPeerLeft: (name: string) => void;
}

export class NetSession implements PlaySession {
  readonly kind = 'net' as const;
  private readonly keyboard: KeyboardInput;
  private readonly lockstep: Lockstep;
  private readonly mySlot: number;
  private readonly namesBySlot = new Map<number, string>();
  private commandOverride: { command: Command; ticksRemaining: number } | null = null;
  private readonly onPeerLeftCb: (name: string) => void;
  private readonly unsubLeave: Unsubscribe;
  private disposed = false;

  constructor(opts: NetSessionOptions) {
    this.keyboard = opts.keyboard;
    const liveSlots = opts.roster.map((r) => r.slot);
    for (const r of opts.roster) this.namesBySlot.set(r.slot, r.name);
    const mine = opts.roster.find((r) => r.peerId === opts.selfPeerId);
    if (!mine) throw new Error('NetSession: local peer is not in the roster');
    this.mySlot = mine.slot;
    this.lockstep = new Lockstep(opts.transport, {
      inputDelay: opts.inputDelay,
      localSlots: [this.mySlot],
      liveSlots,
    });
    this.lockstep.onDesync((tick) => opts.onDesync(tick));
    this.onPeerLeftCb = opts.onPeerLeft;
    const roster = opts.roster;
    this.unsubLeave = opts.transport.onPeerLeave((peerId) => {
      if (this.disposed) return;
      const entry = roster.find((r) => r.peerId === peerId);
      this.onPeerLeftCb(entry?.name ?? 'A player');
    });
  }

  localSlots(): number[] {
    return [this.mySlot];
  }

  isPauseAllowed(): boolean {
    return false;
  }

  pressCommand(cmd: Partial<Command>, ticks: number): void {
    this.commandOverride = { command: { ...NEUTRAL_COMMAND, ...cmd }, ticksRemaining: ticks };
  }

  private readLocal(): Command {
    if (this.commandOverride) {
      const cmd = this.commandOverride.command;
      this.commandOverride.ticksRemaining--;
      if (this.commandOverride.ticksRemaining <= 0) this.commandOverride = null;
      return cmd;
    }
    // Every net client drives with the P1 keyboard scheme locally regardless
    // of slot — each client is "player 1" on its own keyboard (net/CLAUDE.md).
    return this.keyboard.readCommand();
  }

  commandsForNextTick(): Record<string, Command> | null {
    const bySlot = this.lockstep.commandsForNextTick(() => this.readLocal());
    if (!bySlot) return null;
    const commands: Record<string, Command> = {};
    for (const [slot, cmd] of Object.entries(bySlot)) commands[playerIdForSlot(Number(slot))] = cmd;
    return commands;
  }

  // Called by app.ts right after a successful step()->handleEvents()->
  // tick() (see net/CLAUDE.md's tick invariant) — this only observes
  // `state`, never mutates it.
  afterTick(state: GameState): void {
    if (state.tick % HASH_INTERVAL_TICKS !== 0) return;
    this.lockstep.recordAndBroadcastHash(state.tick, hashState(state));
  }

  missingNames(): string[] {
    return this.lockstep.missingSlots(this.lockstep.confirmedTick).map((slot) => this.namesBySlot.get(slot) ?? `Player ${slot + 1}`);
  }

  confirmedTick(): number {
    return this.lockstep.confirmedTick;
  }

  hashAtTick(tick: number): number | undefined {
    return this.lockstep.hashAtTick(tick);
  }

  debugStallInject(ms: number): void {
    this.lockstep.debugStallInject(ms);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubLeave();
    this.lockstep.dispose();
  }
}
