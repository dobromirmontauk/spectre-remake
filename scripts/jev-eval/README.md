# Local Jev evaluation

Lead only runs paid mode after backend budget review. The backend must enforce a cumulative persistent $10 ceiling before every paid request; browser duration or polling is not a spending guarantee. Start local frontend and optional backend separately. Install Playwright locally if absent (`npm install --no-save playwright`, then `npx playwright install chromium`). Optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects an installed Chromium.

```
node --test scripts/jev-eval/report.test.mjs
node scripts/jev-evaluate.mjs --duration=30 --enabled=true --offline=true --autopilot=true --level=1 --hz=5 --output=reference/verification/jev/baseline
node scripts/jev-evaluate.mjs --duration=30 --enabled=true --autopilot=true --level=1 --hz=5 --video=true --output=reference/verification/jev/model
```

Flags accept `--name=value`. Duration is wall time (maximum 300 seconds), not artificially accelerated simulation. Only loopback URLs accepted. `--offline=true` aborts model endpoint requests and exercises the safe local controller; disabled mode is original scripted AI with no player autopilot/cap. Godmode remains off. Enemy cap is checked continuously; stop on excess, budget exhaustion or game over. Seed is recorded but currently **not applied**: game start uses the built-in deterministic seed. Video optional; Playwright produces WebM. Report/screenshot evidence is written even on most harness failures; keep any failed report alongside successful runs.

Compare equal-duration baseline/model runs with identical start level, loadout and default seed. Network counts distinguish requests, HTTP failures and transport failures. Model inference is claimed only when applied decisions were actually counted. Total decisions/second combines all tanks; per-tank accepted frequency and model-driven tick fraction stay null unless instrumentation supplies exact counters. Screenshots or sparsely sampled state cannot establish zero collisions, zero ally damage, or human fun. Missing counters are explicitly unavailable.

Fun hypotheses to evaluate (not claimed outcomes): player win rate roughly 40–70% over repeated seeds; at least one recoverable low-shield close call per winning run; observable flank/intercept or retreat choices; meaningful flag progress; no prolonged stationary loops or repeated wall impacts. Report player damage/deaths, enemy deaths, flags, close-call ticks, stationary ticks and safety interventions. Close-call ticks count duration, not unique events. Player autopilot is a test opponent, not a human enjoyment rating. Require manual play and watchable gameplay before deciding the experience is fun.
