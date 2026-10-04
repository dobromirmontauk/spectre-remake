# AI mode: ten-game evaluation

Ten actual Jev games completed at 2 Hz with at most three enemies and one player. AI mode is a separate solo ruleset; original modes retain their existing behavior. There were nine scripted-player deaths and one level clear by destroying the entire enemy squad. No game recorded a body contact or friendly-fire damage. The maximum non-firing assigned-movement stall was 2.27 seconds. These are useful squad-performance results, not proof of human difficulty or enjoyment.

This batch spent **$0.338845**. The preserved cumulative experiment ledger moved from **$1.683902 to $2.022747**, below the $9.50 backend stop and $10 authorization. No ledger reset, paid retry loop, god mode, or enlarged enemy roster was used.

## Recordings and exact evidence

- [Top-down squad replay video](squad-replay.mp4): faithful replay of game 05 tick positions, headings, projectiles, mission assignments and tactical actions. Full-scene observer access is for evaluation only. Obstacle geometry is from initial state; decorative windmill blades and pickups are omitted.
- [Normal rendered gameplay video](iteration/game-05-level5-rushflags/gameplay.mp4): the browser recording, converted to H.264 without replacing gameplay.
- [Interactive replay](replay.html): serve this repository over HTTP; use `?game=iteration/game-07-level3-hunt` or another recorded directory to inspect other matches. No provider calls are made.
- Each linked game report has sibling `frames.json.gz`, `actions.json.gz`, `decisions.json.gz`, `provider-audit.json.gz`, initial state, screenshots and native WebM. Full browser observations, offered choices, model decisions and linked backend prompt/response are retained.

## Iteration and comparisons

Games 00–02 used the first integrated AI-mode implementation. After reviewing their recordings and exact actions, we added a tactical reverse withdrawal that keeps the gun on a personally visible threat, and clarified in the prompt that aim/fire should not wait for arrival at a mission waypoint. Critical health prioritizes continuing toward cover; shared-only contacts cannot trigger aimed counterfire. Games 03–05 repeat the same level and flag-rush player policy, then games 06–09 vary evasion and hunting.

For paired Level 1 and Level 3 runs, first-shot medians improved 1.27→0.77 seconds and 1.57→0.77 seconds. Level 5 median worsened 1.07→1.17 seconds, while its sparse p95 improved 8.23→2.93 seconds. Crossfire increased in all three repeats (0→15.0%, 3.3→65.9%, 9.3→13.9%). Personalities and provider choices vary; these are descriptive comparisons, not a controlled causal experiment.

## Contact, shooting and movement

| Game / policy | Result | Seconds | First aimed shot median / p95 (s) | Fired episodes / unfired | Hit % (resolved shots) | Contact shots/s | Crossfire | Longest stall (s) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| [00 · L1 rushflags](baseline/game-00-level1-rushflags/report.json) | Player died | 41.57 | 1.27 / 4.47 | 7 / 6 | 64.29% (14) | 0.25 | 0.0% | 2.23 |
| [01 · L3 rushflags](baseline/game-01-level3-rushflags/report.json) | Player died | 39.47 | 1.57 / 5.07 | 7 / 8 | 68.18% (22) | 0.24 | 3.3% | 1.10 |
| [02 · L5 rushflags](baseline/game-02-level5-rushflags/report.json) | Player died | 53.83 | 1.07 / 8.23 | 5 / 9 | 56.52% (23) | 0.24 | 9.3% | 1.67 |
| [03 · L1 rushflags](iteration/game-03-level1-rushflags/report.json) | Player died | 44.67 | 0.77 / 1.30 | 5 / 1 | 55.00% (20) | 0.30 | 15.0% | 1.07 |
| [04 · L3 rushflags](iteration/game-04-level3-rushflags/report.json) | Player died | 16.90 | 0.77 / 3.57 | 2 / 1 | 100.00% (9) | 0.23 | 65.9% | 1.13 |
| [05 · L5 rushflags](iteration/game-05-level5-rushflags/report.json) | Player died | 42.40 | 1.17 / 2.93 | 8 / 8 | 61.90% (21) | 0.29 | 13.9% | 1.63 |
| [06 · L1 evade](iteration/game-06-level1-evade/report.json) | Player died | 26.07 | 0.83 / 1.10 | 4 / 0 | 90.00% (10) | 0.37 | 0.0% | 1.07 |
| [07 · L3 hunt](iteration/game-07-level3-hunt/report.json) | Player died | 20.33 | 0.80 / 2.77 | 5 / 0 | 83.33% (12) | 0.30 | 20.7% | 1.10 |
| [08 · L5 evade](iteration/game-08-level5-evade/report.json) | Player died | 27.73 | 1.20 / 6.80 | 3 / 1 | 81.82% (11) | 0.28 | 25.0% | 1.33 |
| [09 · L5 hunt](iteration/game-09-level5-hunt/report.json) | Squad destroyed | 15.93 | 0.90 / 1.23 | 4 / 0 | 50.00% (4) | 0.52 | 0.0% | 2.27 |

All first-shot latencies are from contact episodes that actually fired; unfired episodes are shown separately and must not be interpreted as fast reactions. P95 uses empirical nearest rank; with these small samples it often equals the slowest measured episode.

## Remaining five metrics and opportunity use

| Game | Squad reacquire median / p95 (s; episodes) | Estimated safe opportunity use | Damage/contact-second | Search unique cells / duplicate waste | Flag denial proxy / captures | Shield-normalized exchange / squad deaths / retreat success |
|---|---:|---:|---:|---:|---:|---:|
| 00 | 0.33 / 1.30 (5; 0 censored) | 40.0% | 1.89 | 5 / 0.0% | 25.0% / 3 | — / 0 / 0/0 |
| 01 | — / — (0; 0 censored) | 23.9% | 1.96 | 13 / 0.0% | 87.5% / 1 | — / 0 / 0/0 |
| 02 | — / — (0; 0 censored) | 31.1% | 1.61 | 40 / 2.4% | 25.0% / 3 | — / 0 / 0/0 |
| 03 | 1.07 / 1.57 (2; 0 censored) | 40.0% | 2.01 | 9 / 0.0% | 33.3% / 2 | — / 0 / 0/0 |
| 04 | — / — (0; 0 censored) | 2.3% | 2.72 | 12 / 0.0% | 100.0% / 0 | — / 0 / 0/0 |
| 05 | 2.20 / 2.20 (1; 0 censored) | 43.8% | 2.12 | 46 / 8.0% | 0.0% / 2 | — / 0 / 0/0 |
| 06 | 7.67 / 7.67 (1; 0 censored) | 39.3% | 3.61 | 32 / 0.0% | 33.3% / 2 | — / 0 / 0/0 |
| 07 | — / — (0; 0 censored) | 25.5% | 2.95 | 13 / 0.0% | 100.0% / 0 | 1.80 / 0 / 1/1 |
| 08 | — / — (0; 0 censored) | 6.4% | 2.76 | 48 / 4.0% | 0.0% / 2 | — / 0 / 0/0 |
| 09 | 2.57 / 4.37 (2; 0 censored) | 66.7% | 3.09 | 10 / 23.1% | — / 0 | 0.08 / 3 / 0/2 |

The [executable metric definitions](../../../../scripts/ai-mode-eval/README.md) cover all ten metrics: reacquisition, first aimed shot, contact firing/opportunity use, resolved hit accuracy, damage pressure, useful crossfire, search coverage, movement stalls, flag defense and survival. Reports include raw denominators, censored episodes, pending shots and additional diagnostics. A dash means unavailable, not zero. Damage is shield-normalized because players have 100 shield while drones can have only 3.

## What remains weak

- Median response met the provisional ≤2-second target in all seven revised runs. Six of seven revised runs met the ≤5-second p95 target; game 08 still reached 6.80 seconds. Long unfired contacts remain, including a 12.53-second end-censored episode in game 04. More reliable aim/fire execution deserves further work.
- Estimated safe opportunity use is low in some games (2.3% in game 04). This includes stationary aligned ray opportunities at 30 Hz, not independent 2 Hz model decisions; cooldown and actual legal-shot corrections are applied, but it remains an estimate.
- Nine losses by a limited scripted player do not establish a fair human win rate. The hunting policy itself can switch to conservative retreat and is not a skilled human adversary. Game 09 proves a player can destroy the finite squad, not that the matchup is balanced.
- Game 07 contains one observed successful retreat: a damaged member survives at least five seconds without losing more shield. Game 09 has two failed recovery attempts ending in observed deaths and all three enemies die. Those are not successful retreats. Evidence for death avoidance is sparse.
- Crossfire measures simultaneous safe lanes, not causal coordination or successful simultaneous hits. Flag denial counts approach exits or attacker death without capture, not proven time gained over a counterfactual.
- No multi-minute idle stall recurred in this short suite. Turning reversals were not given a separate jiggle KPI; recordings and executor regressions remain the check for that behavior.

## Provenance and validation

Baseline runtime includes mode integration `f23b703`; revised runtime includes reverse withdrawal `791c037` and prompt clarification `a51325e`. Each report preserves its recording checkout SHA and hashes of the actual loaded source modules. Checkpoint revisions differ from the final publication commit; raw evidence identifies what ran.

The lead ran the real browser AI-mode UI scenario, finite-roster/player-life/level-clear regressions, squad and withdrawal regressions, scheduler checks, backend budget/audit tests and production build. Normal-mode deterministic fixtures remained unchanged. Seventeen observer tests passed, including failing-first reproductions of the measurement corrections below.

Reports were recomputed from unchanged raw frames/actions to correct cooldown readiness after decrement, legal shots that align after steering, null accuracy for all-pending shots, sparse quantiles, render-batch spill into the next level, actual firing heading after steering, and death-ending contact/recovery episodes. Evaluation ends at the first terminal tick; raw trace and native video may include a few next-level frames. In game 09, all three Level 5 enemies are permanently dead at tick 478, then a new Level 6 roster is created; that is level progression, not respawning.

Full observations remain within the AI-mode commander contract: own sensing, dated known objectives, authorized squad radio observations and level-specific map/ally information. Hidden current player coordinates are not passed to models. Detailed audit data is public test evidence; API credentials and the continuously growing local spend ledger are excluded.
