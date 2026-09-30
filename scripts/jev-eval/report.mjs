export function summarizeRun({ config, samples, network, errors, stoppedReason, elapsedSeconds }) {
  const last = samples.at(-1) ?? {};
  const metrics = last.metrics ?? {};
  const decisions = metrics.modelDecisions ?? metrics.decisionsApplied ?? metrics.decisions ?? 0;
  const tanks = last.state ? [ ...(last.state.players ?? []), ...(last.state.enemies ?? []) ] : [];
  return {
    schemaVersion: 1, config, elapsedSeconds, stoppedReason,
    inferenceEvidence: config.enabled && !config.offline && decisions > 0 ? 'model-decisions-observed' : 'no-model-decisions-observed',
    network, errors, metrics,
    outcome: last.state ? { level: last.state.level, score: last.state.score,
      flagsCollected: last.state.flagsCollected, gameOver: last.state.gameOver,
      players: (last.state.players ?? []).map(t => ({ id:t.id, shield:t.shield, lives:t.lives, kills:t.kills, alive:t.alive })),
      enemyCount: (last.state.enemies ?? []).length } : null,
    effectiveDecisionsPerSecond: elapsedSeconds > 0 ? decisions / elapsedSeconds : 0,
    // Full fidelity collision/friendly-fire counts require tick instrumentation, not sparse screenshots.
    unavailableKPIs: ['human fun rating', ...(['wallHits','tankContactTicks','friendlyFireDamage','closeCallTicks','lowShieldRecoveries','stationaryTicks','chaseLoops'].filter(k => metrics[k] === undefined))],
    observedTankCount: tanks.length,
    maxActualEnemies: Math.max(0,...samples.map(s => s.state?.enemies?.length ?? 0)),
    maxRequestedTanks: metrics.maxRequestedTanks ?? null,
    effectiveAcceptedHzPerTank: metrics.effectiveHzPerTank ?? null,
    modelDrivenTickFraction: metrics.modelTicks !== undefined && metrics.observedTicks > 0 ? metrics.modelTicks / metrics.observedTicks : null,
    contextSample: samples.find(s => s.observation)?.observation ?? null, samples,
  };
}
