// These estimates miss motion/events between samples and never replace tick counters.
export function sampledKPIs(samples) {
  const tracks = new Map();
  for (const sample of samples) {
    for (const tank of [...(sample.state?.players ?? []), ...(sample.state?.enemies ?? [])]) {
      const track = tracks.get(tank.id) ?? { distance:0, stationarySeconds:0, lowShieldEpisodes:0, recoveries:0, previous:null, low:false };
      const previous = track.previous;
      const continuous = previous && previous.level === sample.state.level && previous.tank.alive && tank.alive && previous.tank.lives === tank.lives;
      if (continuous) {
        const distance = Math.hypot(tank.position.x-previous.tank.position.x,tank.position.z-previous.tank.position.z);
        track.distance += distance;
        if (distance < 0.1) track.stationarySeconds += Math.max(0,sample.elapsedSeconds-previous.time);
      } else track.low = false;
      if (tank.alive && tank.shield <= tank.maxShield * 0.25 && !track.low) {track.low=true;track.lowShieldEpisodes++;}
      if (continuous && track.low && tank.shield > tank.maxShield * 0.5) {track.recoveries++;track.low=false;}
      track.previous = {tank,time:sample.elapsedSeconds,level:sample.state.level};tracks.set(tank.id,track);
    }
  }
  return { provenance:'sample-derived; 200ms snapshots; motion/events between samples can be missed', tanks:Object.fromEntries([...tracks].map(([id,t]) => [id,{distance:t.distance,stationarySeconds:t.stationarySeconds,lowShieldEpisodes:t.lowShieldEpisodes,lowShieldRecoveries:t.recoveries}])) };
}
// Never persist arbitrary server body text: credentials might be echoed by an error.
export function safeHttpFailure(status, body) {
  let code = null;
  try {const parsed = JSON.parse(body);const candidate=parsed.code ?? parsed.error?.code;if (typeof candidate==='string' && /^(budget_exhausted|invalid_request|unauthorized|rate_limited|provider_error|backend_unavailable)$/.test(candidate)) code=candidate;} catch {}
  return {status,code,bodyOmitted:true};
}
