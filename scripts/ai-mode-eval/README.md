# Finite squad AI evaluation

This harness never runs paid calls by default. `--paid=true` is for the lead only after confirming the persistent backend ledger, pending reservations, audit health and remaining $10 authorization. Browser safety checks supplement the backend's reservation accounting, which remains the actual spending guarantee. Do not restart or reset the ledger to obtain more room.

```
node --test scripts/ai-mode-eval/metrics.test.mjs
PLAYWRIGHT_MODULE=/absolute/node_modules/playwright/index.mjs node scripts/ai-mode-eval/run.mjs --games=1 --duration=5 --out=/tmp/squad-mocked
# Lead only; no --paid means MOCK FIXTURE decisions, never quality evidence:
node scripts/ai-mode-eval/run.mjs --paid=true --games=3 --start=0 --duration=90 --profile=scripted --out=test/validation/ai-mode/2026-10-01/baseline
node scripts/ai-mode-eval/run.mjs --paid=true --games=7 --start=3 --duration=90 --profile=scripted --out=test/validation/ai-mode/2026-10-01/iteration
```

Fresh output directory required; archives are never overwritten. Local frontend must serve optional backend APIs. Vite module interception exposes the real session constructor solely to evaluation instrumentation. No gameplay/session files are modified. The ten scenarios include paired flag-rush runs at levels 1/3/5 (indices 0–2 and 3–5), followed by evade/hunt cases across those levels. Built-in deterministic level seed is recorded; no independent seed override. `--profile=scripted` replaces only the main player's command with deterministic own-perception candidate selection and safe local execution, refreshed every15 ticks. Enemy choices remain actual provider decisions in paid mode. `--profile=jev` uses a separate player Jev decision (stochastic comparison caveat). Comparable tests must repeat scenario index/profile and game source SHA across prompt revisions; Only matched scenario subsets can support descriptive before/after comparison; provider decisions and commander personalities remain stochastic.

Actual finite AI mode is required: one player life, no more than3 enemies, no godmode. Stop on first level-clear/death, duration (max120 wall seconds), roster violation or budget warning. Per-tick observer instrumentation records exact current FOV/LOS, ray safety, commands, assigned missions, actual ShotFired events and projectile IDs. Full scene is evaluator-only; it is never passed to the enemy provider. Per-run files include initial state, exact tick frames/actions, browser request/decision log, linked provider audit (paid mode), screenshots, native Playwright WebM and summary. Replay state frames omit geometry to limit size; initial-state retains it. Browser video is rendered gameplay, not a synthesized narrative. Lead handles video conversion, visual review and LFS.

Ten metrics, defined in `metrics.mjs`:

1. Contact reacquisition: time between squad-union own FOV/LOS loss and rediscovery by any squad member; median/p95 and right-censored losses. Individual observer handoffs are continuous contact; per-tank times remain an extra diagnostic.
2. First aimed shot: first actual cannon shot during own contact; median/p95 plus ended or censored unfired episodes.
3. Contact shooting rate and fraction of estimated cooldown-ready, aligned, unobstructed teammate-safe ray opportunities actually fired. Pre-command cooldown 1 becomes ready before firing in this tick; actual legal shots are included even when steering creates alignment after the pre-command ray estimate. Rays are observer safety estimates, not predicted hit guarantees.
4. Resolved enemy projectile hit percentage. IDs link ShotFired/ShotHit; disappearance without hit resolves a miss; projectiles still present at stop are censored. Missing IDs make accuracy unavailable rather than invented. ShotHit metadata distinguishes target kind.
5. Player damage per enemy-tank contact-second. Concurrent observers add exposure seconds; this is not wall time.
6. Useful crossfire fraction: at least two own-visible, safely aligned lanes to one target, with directions separated≥45°; denominator combat ticks with at least2 living enemies and any enemy contact.
7. Global unique10-unit search cells per actual alive searching tank-minute and duplicate cell entry fraction across the squad. Search=patrol/explore without contact. Revisits can be useful; this is a search efficiency proxy.
8. Assigned movement stall fraction and longest consecutive run: non-hold assigned waypoint at least3 units away, abs(speed)<0.5, **including zero-thrust safety-guard stalls**; useful aligned firing ticks excluded. Stationary aiming is not automatically faulty.
9. Unique flag approach episodes (enter18-unit radius), resolved exits/attacker deaths without capture, captured episodes and right-censored ongoing episodes; capture denial fraction is a proxy over resolved episodes only. Also reports captures, approach duration and censored time-to-clear. Duration is explicitly a **time bought proxy**, not causal delay relative to another controller.
10. Squad raw damage exchange (unequal shield sizes explicitly flagged), shield-fraction-normalized damage exchange, permanently dead enemies and retreat success. A retreat/recover episode succeeds if alive5seconds later with shields no lower than entry. Current implementation records one such episode/tank; unresolved episodes are conservatively censored, not asserted failures.

Body contacts, friendly fire, budget, observer duration and stop reason are additional diagnostics. These numbers do not prove human enjoyment. Lead acceptance targets are provisional: zero contacts/ally damage, no nonfiring movement stall>5s, first-shot median≤2s/p95≤5s, stable useful missions and watchable pressure/close calls. Inspect video and exact logs before attributing coordinated intent or calling a maneuver smart.
