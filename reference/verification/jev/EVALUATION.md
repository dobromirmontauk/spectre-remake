# Local Jev evaluation — 2026-09-29

Source: Spectre main c7c041626c31bab5871fec60472985fc424397e5. Jev 1.13.0, 2 Hz, player autopilot, god mode off, maximum three enemies plus the player. Commander observation/privacy and safety contract: [JEV-DESIGN.md](../../../JEV-DESIGN.md).

| Trial | Duration | Accepted Hz/tank | Batch p50 / p95 | Model command coverage | Flags / enemy kills / player deaths | Obstacle contacts / tank contacts / friendly damage |
| --- | --- | --- | --- | --- | --- | --- |
| verified-level3 | 120s | 1.92 | 254 / 339 ms | 98.4% | 15 / 9 / 0 | 0 / 0 / 0 |
| verified-level6 | 60s | 1.90 | 256 / 345 ms | 98.8% | 6 / 1 / 0 | 0 / 0 / 0 |

The level 3 trial cleared level 3 and reached level 4, collected 15 flags, destroyed nine enemies, lost no lives and finished at 18% shield. It spent 377 simulation ticks below 25% shield; the low-shield episode had not healed above 50% when testing ended. This is pressure and survival evidence, not a completed low-shield healing recovery. The denser level 6 trial collected six flags and destroyed one enemy; guarded tanks sometimes remained stationary. No claim of optimal navigation or a measured human win rate is made.

Actual Jev commander fixtures chose engagement when healthy, shield resupply at 8% shield, and ammunition at zero ammo: [commander-fixtures.json](commander-fixtures.json). Actual menu/checkbox browser test sent no requests when disabled and none after switching off: [ui-control-check.json](ui-control-check.json).

Total recorded experiment spend: **$0.391572**, across 4,608 provider attempts, including retained reservations for unknown usage. The server stops at $9.50, below the authorized $10. [budget-final.json](budget-final.json) is a snapshot; the live cumulative ledger remains ignored and is never reset.

Videos: [level 3](verified-level3/gameplay.mp4), [level 6](verified-level6/gameplay.mp4). Compact reports have companion samples.json.gz preserving all sampled states. Ending video frames/screenshots are paused after the harness disables Jev to stop testing; this is not a mid-run failure. A final outstanding request aborted on shutdown is distinct from a failed inference during active gameplay.

## Verification

Lead independently ran production build/sim purity, controller perception/braking/ram/friendly-fire tests, serialized failing-first live UNSTICK regression, scheduler/lifecycle/budget tests, normal firing cooldown regression, 17 mocked backend/report tests, dmath accuracy and 20-checkpoint cross-engine determinism. Chromium normal solo/co-op/duel regressions also pass; original hashes remain identical. Lead ran and visually inspected live Jev gameplay plus captured video frames.

## Remaining playtest questions

Human fun is unmeasured. The hypotheses are 40–70% human wins after practice, meaningful tactical decisions and recoverable close calls; those need repeated varied trials and human play. Requested CLI seeds are recorded but unapplied. Level-specific built-in seeds differ, and Jev/network timing can vary. The direct local planner has no global route search; dense geometry and long guarding periods deserve further human review.

## Iteration trail

Retained earlier reports cover HTTP 400 wire IDs (no paid calls), spacing deadlock, moving tank contacts, windmill impact and an arena edge contact. The final edge cause was scripted UNSTICK overriding external Jev commands; that override is removed only for externally controlled enemies. Each physical regression has a failing-first automated reproduction. Final trials above use the corrected code.
