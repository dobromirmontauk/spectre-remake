import type { GameState, TankState } from '../sim/types.ts';
import type { SimEvent } from '../sim/events.ts';
import type { Command } from '../sim/commands.ts';
import { PersonalityAssignments } from '../jev/personality.ts';
import { observeTank } from '../jev/observation.ts';
import { separateJevSpawns } from '../jev/placement.ts';
import { buildCandidates, commandForPlan } from '../jev/controller.ts';
import { DecisionAuditStore, type DecisionAudit } from './jev-audit.ts';
import type { TankMemory, TankObservation, TacticalPlan, Strategy } from '../jev/types.ts';

const REQUEST_TIMEOUT_MS = 1500;
const PLAN_MAX_AGE_TICKS = 30;
export class JevSession {
  private personalities: PersonalityAssignments;
  private auditStore = new DecisionAuditStore();
  private auditRevision = 0;
  private auditRecords: DecisionAudit[] = [];
  private auditBySequence: Record<number, DecisionAudit> = {};
  private pendingAudit: DecisionAudit | null = null;
  private acceptedStrategies: Record<string, Strategy> = {};
  getAuditRevision(): number { return this.auditRevision; }
  getDecisionLog(): DecisionAudit[] { return structuredClone(this.auditRecords); }
  exportDecisionLog(): Promise<DecisionAudit[]> { return this.auditStore.exportAll(); }
  private saveAudit(record: DecisionAudit, event: 'attempt' | 'response' | 'outcome' | 'applied'): void {
    this.auditRevision++; this.auditStore.save(record);
    // Durable backend metadata complements browser exact input storage and upstream history.
    // This optional endpoint never invokes the model, and failure leaves the game unaffected.
    if (typeof window !== 'undefined') void globalThis.fetch('/api/jev/audit/browser', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserSessionId: record.browserSessionId, sequence: record.sequence, tick: record.tick, event, at: new Date().toISOString(), details: { outcome: record.outcome, error: record.error, decisions: record.decisions, latencyMs: record.latencyMs, ...(event === 'attempt' ? { request: record.request } : {}), ...(event === 'response' ? { response: record.response, ...(record.responseText !== undefined ? { responseText: record.responseText } : {}) } : {}) } }),
    }).catch(() => {});
  }
  private finishUnapplied(tankId: string, reason: 'superseded' | 'expired' | 'session reset' | 'life ended' | 'budget exhausted'): void {
    const audit = this.auditBySequence[this.selectionSerial[tankId]!];
    const decision = audit?.decisions.find(d => d.tankId === tankId && d.accepted && !d.applied && !d.notAppliedReason);
    if (audit && decision) { decision.notAppliedReason = reason; this.saveAudit(audit, 'outcome'); }
  }
  private budgetExhausted = false;
  private lastSafetyEvents: { tick: number; level: number; event: SimEvent; tanks: { id: string; position: { x: number; z: number }; prevPosition: { x: number; z: number }; heading: number; speed: number; alive: boolean; controlled: boolean; planId: string | null; modelAgeTicks: number | null; expired: boolean }[] }[] = [];
  private modelTicks: Record<string, number> = {};
  private settings = { enabled: false, playerAutopilot: false, hz: 2 };
  private placementLevel = -1;
  private placementTick = -1;
  private placementAlive: Record<string,boolean> = {};
  private memories: Record<string, TankMemory> = {};
  private observations: Record<string, TankObservation> = {};
  private plans: Record<string, TacticalPlan> = {};
  private sequence = 0;
  private generation = 0;
  private lastTick = -1;
  private clockAt = 0;
  private activeMs = 0;
  private activeTankMs = { enemy: 0, player: 0 };
  private activeTankCount = { enemy: 0, player: 0 };
  private acceptedByRole = { enemy: 0, player: 0 };
  private latencySamplesMs: number[] = [];
  private appliedChoiceHistogram: Record<string, { role: 'enemy' | 'player'; id: string; category: string; count: number }> = {};
  private lifeSerial: Record<string, number> = {};
  private selectionSerial: Record<string, number> = {};
  private appliedSerial: Record<string, number> = {};
  private identity = '';
  private nextAt = 0;
  private pending: AbortController | null = null;
  private active = false;
  private status = 'Disabled · scripted AI';
  private interventions = { wallAvoided: 0, tankAvoided: 0, allyShotAvoided: 0 };
  private counters = { requests: 0, maxRequestedTanks: 0, modelDecisions: 0, modelCommandTicks: 0, fallbackTicks: 0, staleResponses: 0, failures: 0, inputTokens: 0, spentUsd: 0, latencyMs: 0, wallHits: 0, obstacleContacts: 0, tankContacts: 0, friendlyFireHits: 0, friendlyFireDamage: 0, playerDamage: 0, enemyProjectileDamage: 0, playerDeaths: 0, enemyDeaths: 0, shots: 0, flags: 0, closeCallTicks: 0, tankContactTicks: 0, stationaryTicks: 0, observedTicks: 0 };
  private fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init), random: () => number = Math.random) { this.fetcher = fetcher; this.personalities = new PersonalityAssignments(random); }
  configure(opts: Partial<{ enabled: boolean; playerAutopilot: boolean; hz: number }>): void {
    if (opts.hz !== undefined && opts.hz !== 2 && opts.hz !== 5) throw new Error('Jev cadence must be 2 or 5 Hz');
    this.settings = { ...this.settings, ...Object.fromEntries(Object.entries(opts).filter(([, value]) => value !== undefined)) };
    this.invalidate();
    this.status = this.settings.enabled ? (this.budgetExhausted ? 'Budget exhausted · offline guards · no paid requests' : 'Ready · offline fallback until Jev responds') : 'Disabled · scripted AI';
  }
  getStats() {
    const extra = this.active ? Math.max(0, performance.now() - this.clockAt) : 0;
    const tankSeconds = {
      enemy: (this.activeTankMs.enemy + extra * this.activeTankCount.enemy) / 1000,
      player: (this.activeTankMs.player + extra * this.activeTankCount.player) / 1000,
    };
    const totalTankSeconds = tankSeconds.enemy + tankSeconds.player;
    const samples = [...this.latencySamplesMs].sort((a, b) => a - b);
    const percentile = (p: number) => samples.length ? samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)]! : 0;
    return {
      ...this.counters, interventions: { ...this.interventions }, ...this.settings,
      activeSeconds: (this.activeMs + extra) / 1000,
      activeTankSeconds: tankSeconds,
      acceptedHzPerTank: totalTankSeconds ? this.counters.modelDecisions / totalTankSeconds : 0,
      acceptedHzByRole: { enemy: tankSeconds.enemy ? this.acceptedByRole.enemy / tankSeconds.enemy : 0, player: tankSeconds.player ? this.acceptedByRole.player / tankSeconds.player : 0 },
      latencySamplesMs: [...this.latencySamplesMs], latencyP50Ms: percentile(.5), latencyP95Ms: percentile(.95),
      appliedChoiceHistogram: structuredClone(this.appliedChoiceHistogram), latestPlans: structuredClone(this.plans), latestStrategies: { ...this.acceptedStrategies },
      lastSafetyEvents: structuredClone(this.lastSafetyEvents), budgetExhausted: this.budgetExhausted,
      pending: !!this.pending, status: this.status, active: this.active,
    };
  }
  getObservation(id: string) { return this.observations[id] ? structuredClone(this.observations[id]) : null; }
  private invalidate(): void {
    for (const tankId of Object.keys(this.plans)) this.finishUnapplied(tankId, 'session reset');
    this.generation++;
    if (this.pendingAudit?.outcome === 'pending') { this.pendingAudit.outcome = 'canceled'; this.pendingAudit.error = 'Session suspended, reset or reconfigured'; this.saveAudit(this.pendingAudit, 'outcome'); }
    this.pending?.abort(); this.pending = null; this.pendingAudit = null; this.acceptedStrategies = {};
    this.modelTicks = {}; this.plans = {}; this.memories = {}; this.observations = {}; this.nextAt = 0;
  }
  enforceRoster(state: GameState, local = true): void {
    if (this.settings.enabled && local && state.mode === 'solo' && state.players.length === 1) {
      state.enemies.splice(3);
      if(this.placementLevel!==state.level||state.tick<this.placementTick){this.placementAlive={};this.placementLevel=state.level;}
      const spawned=state.enemies.filter(e=>e.alive&&!this.placementAlive[e.id]).map(e=>e.id);
      separateJevSpawns(state,spawned);
      for(const e of state.enemies)this.placementAlive[e.id]=e.alive;
      this.placementTick=state.tick;
    }
  }
  update(state: GameState, now: number, playing: boolean, local: boolean, visible: boolean): void {
    const active = this.settings.enabled && playing && local && visible && state.mode === 'solo' && state.players.length === 1 && !state.gameOver;
    const player = state.players[0];
    const identity = `${state.level}`;
    if (identity !== this.identity || state.tick < this.lastTick) this.personalities.reset();
    if (identity !== this.identity || state.tick < this.lastTick || (!active && this.active)) { this.invalidate(); this.identity = identity; }
    if (this.active) {
      const elapsed = Math.max(0, now - this.clockAt);
      this.activeMs += elapsed;
      this.activeTankMs.enemy += elapsed * this.activeTankCount.enemy;
      this.activeTankMs.player += elapsed * this.activeTankCount.player;
    }
    this.clockAt = now;
    this.activeTankCount = active ? { enemy: state.enemies.filter(t => t.alive).slice(0, 3).length, player: this.settings.playerAutopilot && player?.alive ? 1 : 0 } : { enemy: 0, player: 0 };
    this.active = active;
    this.lastTick = state.tick;
    if (!active) { if (this.settings.enabled) this.status = 'Suspended · single-player, visible, unpaused gameplay only'; return; }
    this.enforceRoster(state, local);
    if (this.budgetExhausted) { this.status = 'Budget exhausted · offline guards · no paid requests'; return; }
    if (this.pending || now < this.nextAt) return;
    this.nextAt = now + 1000 / this.settings.hz;
    const tanks = [...state.enemies.filter(t => t.alive), ...(this.settings.playerAutopilot && player?.alive ? [player] : [])];
    const candidates: Record<string, TacticalPlan[]> = {};
    // Only reports actually observed by an ally can enter squad context.
    // First pass uses each commander's own perception; final pass adds permitted reports.
    const sharedSightings = tanks.filter(t => state.enemies.some(e => e.id === t.id)).flatMap(tank => {
      const memory = this.memories[tank.id] ??= { seen: {} };
      return observeTank(state, tank.id, memory).contacts.filter(c => c.kind === 'tank' && c.team === 'player' && c.seenTick === state.tick && c.source === 'own');
    });
    const payload = tanks.map(tank => {
      const memory = this.memories[tank.id] ??= { seen: {} };
      const observation = observeTank(state, tank.id, memory, { sharedSightings: state.enemies.some(e => e.id === tank.id) ? sharedSightings : [], strategies: this.acceptedStrategies });
      observation.own.personality = this.personalities.get(tank.id, tank.id === player?.id);
      this.observations[tank.id] = observation;
      const choices = buildCandidates(observation, tank.position); candidates[tank.id] = choices;
      return { tankId: tank.id, role: tank.id === player?.id ? 'player' : 'enemy', observation, candidates: choices.map(c => ({ id: c.id, description: c.description })) };
    });
    if (!payload.length) return;
    this.counters.maxRequestedTanks = Math.max(this.counters.maxRequestedTanks, payload.length);
    const sequence = ++this.sequence, generation = this.generation, tick = state.tick;
    const lives = { ...this.lifeSerial }, level = state.level;
    const request = { version: 1, sequence, tick, tanks: payload };
    const audit: DecisionAudit = { id: `${this.auditStore.sessionId}:${sequence}`, browserSessionId: this.auditStore.sessionId, sequence, tick, level, at: new Date().toISOString(), request: JSON.parse(JSON.stringify(request)), outcome: 'pending', decisions: [] };
    this.auditRecords.push(audit); this.auditBySequence[sequence] = audit;
    if (this.auditRecords.length > 100) { const old = this.auditRecords.shift()!; delete this.auditBySequence[old.sequence]; }
    this.pendingAudit = audit; this.saveAudit(audit, 'attempt');
    const abort = new AbortController(); this.pending = abort;
    const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    const started = performance.now(); this.counters.requests++;
    void this.fetcher('/api/jev/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal, body: JSON.stringify(request) })
      .then(async response => {
        const responseText = await response.text();
        let body: unknown;
        try { body = JSON.parse(responseText); } catch { body = null; audit.responseText = responseText; }
        audit.response = structuredClone(body); audit.latencyMs = performance.now() - started;
        this.saveAudit(audit, 'response');
        if (response.status === 402) {
          this.budgetExhausted = true;
          for (const tankId of Object.keys(this.plans)) this.finishUnapplied(tankId, 'budget exhausted');
          this.plans = {};
          const details: unknown = body; audit.outcome = 'budget';
          if (details && typeof details === 'object' && 'spentUsd' in details && typeof details.spentUsd === 'number' && Number.isFinite(details.spentUsd) && details.spentUsd >= 0) this.counters.spentUsd = details.spentUsd;
          this.status = 'Budget exhausted · offline guards · no paid requests';
          throw new Error('Budget exhausted');
        }
        if (!response.ok) throw new Error(`Backend ${response.status}`); return body as { sequence: number; tick: number; decisions: { tankId: string; choice: string; confidence?: number; callId?: string }[]; usage?: { inputTokens?: number }; spentUsd?: number }; })
      .then(response => {
        if (!response || typeof response !== 'object' || Array.isArray(response) || !Array.isArray(response.decisions) || response.decisions.some(d => !d || typeof d.tankId !== 'string' || typeof d.choice !== 'string') || (response.usage?.inputTokens !== undefined && (!Number.isSafeInteger(response.usage.inputTokens) || response.usage.inputTokens < 0)) || (response.spentUsd !== undefined && (!Number.isFinite(response.spentUsd) || response.spentUsd < 0))) throw new Error('Invalid decision response');
        this.counters.inputTokens += response.usage?.inputTokens ?? 0;
        this.counters.spentUsd = response.spentUsd ?? this.counters.spentUsd;
        this.counters.latencyMs = performance.now() - started;
        this.latencySamplesMs.push(this.counters.latencyMs);
        if (this.latencySamplesMs.length > 1000) this.latencySamplesMs.shift();
        audit.decisions = response.decisions.map(decision => {
          const plan = candidates[decision.tankId]?.find(c => c.id === decision.choice);
          return { tankId: decision.tankId, role: state.players.some(p => p.id === decision.tankId) ? 'player' : 'enemy', choice: decision.choice, description: plan?.description ?? 'Unknown candidate; discarded', strategy: plan?.strategy, confidence: decision.confidence, callId: decision.callId, accepted: false, applied: false };
        });
        if (generation !== this.generation || !this.active || response.sequence !== sequence || response.tick !== tick || state.level !== level || state.tick - tick > PLAN_MAX_AGE_TICKS || state.tick < tick) { this.counters.staleResponses++; if (audit.outcome !== 'canceled') audit.outcome = 'stale'; this.saveAudit(audit, 'outcome'); return; }
        let accepted = 0;
        for (const decision of response.decisions) {
          const plan = candidates[decision.tankId]?.find(c => c.id === decision.choice);
          const tank = [...state.enemies, ...state.players].find(t => t.id === decision.tankId);
          const logged = audit.decisions.find(d => d.tankId === decision.tankId && d.choice === decision.choice)!;
          if (plan && tank?.alive && plan.expiresTick >= state.tick && (lives[tank.id] ?? 0) === (this.lifeSerial[tank.id] ?? 0)) { this.finishUnapplied(decision.tankId, 'superseded'); logged.accepted = true; if (plan.strategy) this.acceptedStrategies[decision.tankId] = plan.strategy; this.plans[decision.tankId] = plan; this.selectionSerial[decision.tankId] = sequence; this.modelTicks[decision.tankId] = tick;
            this.acceptedByRole[state.players.some(p => p.id === tank.id) ? 'player' : 'enemy']++; accepted++; }
        }
        audit.outcome = accepted ? 'accepted' : 'stale'; this.saveAudit(audit, 'outcome');
        this.counters.modelDecisions += accepted;
        if (this.counters.latencyMs > 200 && this.settings.hz === 5) this.settings.hz = 2;
        this.status = accepted ? `Jev live · ${this.settings.hz} Hz · ${Math.round(this.counters.latencyMs)} ms` : 'Offline fallback · no valid Jev decisions';
      }).catch(error => { audit.latencyMs = performance.now() - started; if (audit.outcome !== 'canceled' && audit.outcome !== 'budget') audit.outcome = 'failed'; audit.error = error instanceof Error ? error.message : 'Request failed'; this.saveAudit(audit, 'outcome'); if (generation === this.generation) { this.counters.failures++; this.status = this.budgetExhausted ? 'Budget exhausted · offline guards · no paid requests' : `Offline fallback · ${error instanceof Error ? error.message : 'backend unavailable'}`; } })
      .finally(() => { clearTimeout(timeout); if (this.pending === abort) { this.pending = null; this.pendingAudit = null; } });
  }
  command(state: GameState, tank: TankState): Command {
    const plan = this.plans[tank.id];
    if (!plan || plan.expiresTick < state.tick) { if (plan) this.finishUnapplied(tank.id, 'expired'); this.counters.fallbackTicks++; return commandForPlan(state, tank.id, null, this.interventions); }
    if (this.appliedSerial[tank.id] !== this.selectionSerial[tank.id]) {
      this.appliedSerial[tank.id] = this.selectionSerial[tank.id]!;
      const role = state.players.some(p => p.id === tank.id) ? 'player' : 'enemy';
      const key = `${role}:${plan.id}`;
      const entry = this.appliedChoiceHistogram[key] ??= { role, id: plan.id, category: plan.id.split(':')[0]!, count: 0 };
      entry.count++;
      const audit = this.auditBySequence[this.selectionSerial[tank.id]!];
      const decision = audit?.decisions.find(d => d.tankId === tank.id && d.accepted);
      if (audit && decision) { decision.applied = true; decision.appliedTick = state.tick; this.saveAudit(audit, 'applied'); }
    }
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
      if (event.type === 'ObstacleContact' || event.type === 'TankContact' || event.type === 'FriendlyFireHit') {
        const ids = event.type === 'TankContact' ? [event.tankId, event.otherTankId] : event.type === 'FriendlyFireHit' ? [event.shooterId, event.tankId] : [event.tankId];
        const tick = Math.max(0, state.tick - 1);
        const tanks = ids.flatMap(id => {
          const tank = [...state.players, ...state.enemies].find(t => t.id === id);
          if (!tank) return [];
          const plan = this.plans[id], issued = this.modelTicks[id];
          return [{ id, position: { ...tank.position }, prevPosition: { ...tank.prevPosition }, heading: tank.heading, speed: tank.speed, alive: tank.alive, controlled: state.enemies.some(t => t.id === id) || this.settings.playerAutopilot, planId: plan?.id ?? null, modelAgeTicks: issued === undefined ? null : tick - issued, expired: !plan || plan.expiresTick < tick }];
        });
        this.lastSafetyEvents.push({ tick, level: state.level, event: structuredClone(event), tanks });
        if (this.lastSafetyEvents.length > 32) this.lastSafetyEvents.shift();
      }
      if (event.type === 'EnemyRespawned' || event.type === 'EnemyDestroyed' || event.type === 'PlayerRespawned' || event.type === 'PlayerDestroyed') {
        const id = event.type === 'EnemyRespawned' || event.type === 'EnemyDestroyed' ? event.enemyId : event.tankId;
        this.personalities.forget(id);
        this.finishUnapplied(id, 'life ended');
        this.lifeSerial[id] = (this.lifeSerial[id] ?? 0) + 1;
        delete this.memories[id]; delete this.observations[id]; delete this.plans[id]; delete this.acceptedStrategies[id];
      }
      if (event.type === 'ObstacleContact') this.counters.obstacleContacts++;
      if (event.type === 'TankContact') this.counters.tankContacts++;
      if (event.type === 'FriendlyFireHit') { this.counters.friendlyFireHits++; this.counters.friendlyFireDamage += event.damage; }
      if (event.type === 'WallHit') this.counters.wallHits++;
      if (event.type === 'TankDamaged' && state.enemies.some(t => t.id === event.tankId)) this.counters.enemyProjectileDamage += event.amount;
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
