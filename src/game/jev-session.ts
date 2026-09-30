import type { GameState, TankState } from '../sim/types.ts';
import type { Command } from '../sim/commands.ts';
import { observeTank } from '../jev/observation.ts';
import { buildCandidates, commandForPlan } from '../jev/controller.ts';
import type { TankMemory, TankObservation, TacticalPlan } from '../jev/types.ts';

const REQUEST_TIMEOUT_MS = 1500;
const PLAN_MAX_AGE_TICKS = 30;
export class JevSession {
  private settings = { enabled: false, playerAutopilot: false, hz: 2 };
  private memories: Record<string, TankMemory> = {};
  private observations: Record<string, TankObservation> = {};
  private plans: Record<string, TacticalPlan> = {};
  private sequence = 0;
  private generation = 0;
  private lastTick = -1;
  private activeStartedAt = 0;
  private activeMs = 0;
  private identity = '';
  private nextAt = 0;
  private pending: AbortController | null = null;
  private active = false;
  private status = 'Disabled · scripted AI';
  private interventions = { wallAvoided: 0, tankAvoided: 0, allyShotAvoided: 0 };
  private counters = { requests: 0, maxRequestedTanks: 0, modelDecisions: 0, modelCommandTicks: 0, fallbackTicks: 0, staleResponses: 0, failures: 0, inputTokens: 0, spentUsd: 0, latencyMs: 0, wallHits: 0, obstacleContacts: 0, tankContacts: 0, friendlyFireHits: 0, friendlyFireDamage: 0, playerDamage: 0, playerDeaths: 0, enemyDeaths: 0, shots: 0, flags: 0, closeCallTicks: 0, tankContactTicks: 0, stationaryTicks: 0, observedTicks: 0 };
  private fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)) { this.fetcher = fetcher; }
  configure(opts: Partial<{ enabled: boolean; playerAutopilot: boolean; hz: number }>): void {
    if (opts.hz !== undefined && opts.hz !== 2 && opts.hz !== 5) throw new Error('Jev cadence must be 2 or 5 Hz');
    this.settings = { ...this.settings, ...Object.fromEntries(Object.entries(opts).filter(([, value]) => value !== undefined)) };
    this.invalidate();
    this.status = this.settings.enabled ? 'Ready · offline fallback until Jev responds' : 'Disabled · scripted AI';
  }
  getStats() { return { ...this.counters, interventions: { ...this.interventions }, ...this.settings, acceptedHzPerTank: this.counters.modelDecisions / Math.max(0.001, (this.activeMs + (this.active ? performance.now() - this.activeStartedAt : 0)) / 1000) / Math.max(1, Object.keys(this.observations).length), pending: !!this.pending, status: this.status, active: this.active }; }
  getObservation(id: string) { return this.observations[id] ? structuredClone(this.observations[id]) : null; }
  private invalidate(): void {
    this.generation++; this.pending?.abort(); this.pending = null;
    this.plans = {}; this.memories = {}; this.observations = {}; this.nextAt = 0;
  }
  enforceRoster(state: GameState, local = true): void {
    if (this.settings.enabled && local && state.mode === 'solo' && state.players.length === 1) state.enemies.splice(3);
  }
  update(state: GameState, now: number, playing: boolean, local: boolean, visible: boolean): void {
    const active = this.settings.enabled && playing && local && visible && state.mode === 'solo' && state.players.length === 1 && !state.gameOver;
    const player = state.players[0];
    const identity = `${state.level}:${player?.lives}`;
    if (identity !== this.identity || state.tick < this.lastTick || (!active && this.active)) { this.invalidate(); this.identity = identity; }
    if (active && !this.active) this.activeStartedAt = now;
    if (!active && this.active) this.activeMs += Math.max(0, now - this.activeStartedAt);
    this.active = active;
    this.lastTick = state.tick;
    if (!active) { if (this.settings.enabled) this.status = 'Suspended · single-player, visible, unpaused gameplay only'; return; }
    this.enforceRoster(state, local);
    if (this.pending || now < this.nextAt) return;
    this.nextAt = now + 1000 / this.settings.hz;
    const tanks = [...state.enemies.filter(t => t.alive), ...(this.settings.playerAutopilot && player?.alive ? [player] : [])];
    const candidates: Record<string, TacticalPlan[]> = {};
    const payload = tanks.map(tank => {
      const memory = this.memories[tank.id] ??= { seen: {} };
      const observation = observeTank(state, tank.id, memory);
      this.observations[tank.id] = observation;
      const choices = buildCandidates(observation); candidates[tank.id] = choices;
      return { tankId: tank.id, role: tank.id === player?.id ? 'player' : 'enemy', observation, candidates: choices.map(c => ({ id: c.id, description: c.description })) };
    });
    if (!payload.length) return;
    this.counters.maxRequestedTanks = Math.max(this.counters.maxRequestedTanks, payload.length);
    const sequence = ++this.sequence, generation = this.generation, tick = state.tick;
    const life = player?.lives, level = state.level;
    const abort = new AbortController(); this.pending = abort;
    const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    const started = performance.now(); this.counters.requests++;
    void this.fetcher('/api/jev/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal, body: JSON.stringify({ version: 1, sequence, tick, tanks: payload }) })
      .then(async response => { if (!response.ok) throw new Error(`Backend ${response.status}`); return await response.json() as { sequence: number; tick: number; decisions: { tankId: string; choice: string }[]; usage?: { inputTokens?: number }; spentUsd?: number }; })
      .then(response => {
        if (generation !== this.generation || !this.active || response.sequence !== sequence || response.tick !== tick || state.level !== level || player?.lives !== life || state.tick - tick > PLAN_MAX_AGE_TICKS || state.tick < tick) { this.counters.staleResponses++; return; }
        let accepted = 0;
        for (const decision of response.decisions) {
          const plan = candidates[decision.tankId]?.find(c => c.id === decision.choice);
          const tank = [...state.enemies, ...state.players].find(t => t.id === decision.tankId);
          if (plan && tank?.alive && plan.expiresTick >= state.tick) { this.plans[decision.tankId] = plan; accepted++; }
        }
        this.counters.modelDecisions += accepted;
        this.counters.inputTokens += response.usage?.inputTokens ?? 0;
        this.counters.spentUsd = response.spentUsd ?? this.counters.spentUsd;
        this.counters.latencyMs = performance.now() - started;
        if (this.counters.latencyMs > 200 && this.settings.hz === 5) this.settings.hz = 2;
        this.status = accepted ? `Jev live · ${this.settings.hz} Hz · ${Math.round(this.counters.latencyMs)} ms` : 'Offline fallback · no valid Jev decisions';
      }).catch(error => { if (generation === this.generation) { this.counters.failures++; this.status = `Offline fallback · ${error instanceof Error ? error.message : 'backend unavailable'}`; } })
      .finally(() => { clearTimeout(timeout); if (this.pending === abort) this.pending = null; });
  }
  command(state: GameState, tank: TankState): Command {
    const plan = this.plans[tank.id];
    if (!plan || plan.expiresTick < state.tick) { this.counters.fallbackTicks++; return commandForPlan(state, tank.id, null, this.interventions); }
    this.counters.modelCommandTicks++;
    return commandForPlan(state, tank.id, plan, this.interventions);
  }
  commands(state: GameState, local: boolean): { enemies: Record<string, { command: Command; fireHeading: number }>; player: Command | null } | null {
    if (!this.settings.enabled || !local || state.mode !== 'solo' || state.players.length !== 1) return null;
    this.enforceRoster(state, local);
    const enemies: Record<string, { command: Command; fireHeading: number }> = {};
    for (const tank of state.enemies) if (tank.alive) enemies[tank.id] = { command: this.command(state, tank), fireHeading: tank.heading };
    const player = state.players[0];
    return { enemies, player: this.settings.playerAutopilot && player?.alive ? this.command(state, player) : null };
  }
  recordTick(state: GameState): void {
    if (!this.settings.enabled || state.mode !== 'solo') return;
    this.counters.observedTicks++;
    for (const event of state.events) {
      if (event.type === 'EnemyRespawned' || event.type === 'PlayerRespawned' || event.type === 'PlayerDestroyed') this.invalidate();
      if (event.type === 'ObstacleContact') this.counters.obstacleContacts++;
      if (event.type === 'TankContact') this.counters.tankContacts++;
      if (event.type === 'FriendlyFireHit') { this.counters.friendlyFireHits++; this.counters.friendlyFireDamage += event.damage; }
      if (event.type === 'WallHit') this.counters.wallHits++;
      if (event.type === 'PlayerDamaged') this.counters.playerDamage += event.amount;
      if (event.type === 'PlayerDestroyed') this.counters.playerDeaths++;
      if (event.type === 'EnemyDestroyed') this.counters.enemyDeaths++;
      if (event.type === 'ShotFired') this.counters.shots++;
      if (event.type === 'FlagCollected') this.counters.flags++;
    }
    const living = [...state.enemies, ...state.players].filter(t => t.alive);
    for (const tank of living) if (Math.hypot(tank.position.x-tank.prevPosition.x,tank.position.z-tank.prevPosition.z)<0.005 && Math.abs(tank.speed)>0.5) this.counters.stationaryTicks++;
    for (let i=0;i<living.length;i++) for(let j=i+1;j<living.length;j++) {
      const a=living[i]!, b=living[j]!;
      if (Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z)<2.1) this.counters.tankContactTicks++;
    }
    const player = state.players[0];
    if (player?.alive && player.shield/player.maxShield<0.25) this.counters.closeCallTicks++;
  }
}
