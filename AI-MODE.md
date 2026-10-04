# AI mode: squad strategy and tactical commanders

AI mode is an optional local single-player experiment. Original solo, local multiplayer and network play retain their existing rules. The selected AI match enables Jev at 2 Hz, limits the enemy roster to three, gives tanks finite lives, and keeps inference out of the pure simulation. Backend credentials remain local; the same cumulative $10 ledger and $9.50 hard stop apply across every iteration.

## Control contract

A deterministic squad planner assigns missions every few seconds and responds to meaningful contact, health and roster changes. Its inputs are commander observations and radio reports originating in actual sightings, not hidden player coordinates. AI-mode radio sharing allows squad members to exchange their observed tracks and known objectives at early levels too; objective precision and advance-map access retain the existing level tiers. Observer evaluation has full scene access solely to measure outcomes.

Squad missions are search, hunt, intercept, attack and recover. They specify each tank's role, objective or search area, risk constraints, deadline and stable assignment identity. Search divides sectors; hunt uses dated sightings and heading with increasing uncertainty; attack separates approach/firing roles; recovery protects vulnerable surviving members. Death removes a member permanently for the current level. Killing the squad or collecting the flags clears the level.

Individual Jev decisions at 2 Hz select short tactical actions inside the assigned mission: advance, establish a firing lane, aim/fire, peek, reposition or evade. A local collision/firing executor runs at 30 Hz. An individual choice cannot replace mission parameters with a new patrol/hunt strategy. Immediate safety maneuvers can temporarily interrupt execution; progress, blockage, contact and danger feed back to squad planning. Repeatedly blocked movements must not remain described as clear feasible patrols.

## Ten evaluation metrics

1. Reacquisition time after losing squad visual contact, including searches censored by death, clear or run end.
2. Contact-to-first-aimed-shot latency, with median/p95 and unfired contact episodes.
3. Firing rate during contact and fraction of safe, fire-ready opportunities used.
4. Player-hit percentage of resolved enemy projectiles, with unresolved shots and friendly hits reported separately.
5. Player damage per contact second, alongside raw damage and contact duration.
6. Useful crossfire time: two living enemies with unobstructed firing opportunities at sufficiently different bearings, divided by eligible engagement time.
7. Search coverage efficiency and duplicate coverage, normalized by actual living tank-time.
8. Nonproductive stall fraction and longest continuous stall during movement assignments; useful stationary firing is not a stall.
9. Flag denial for defined player approaches, with interrupted approaches, captures and censored approaches distinguished.
10. Survival efficiency: damage dealt/received plus permanently lost members and successful retreat outcomes; zero denominators remain explicit.

Full definitions and executable calculations belong in the evaluation harness README. Do not replace unavailable metrics with fabricated zeros. Contact and flag episodes ending at run limits are censored. A kill or death can legitimately shorten the game; ten games means ten independently started matches, not ten full 90-second traces. Provider choices, executed commands and measured effects must remain distinguishable.

## Evaluation and tuning policy

Initial targets are zero friendly damage and physical contacts, no recurrence of the recorded endless flag stall, bounded non-firing stalls, and quick safe firing after contact. Provisional aiming targets are median first-shot latency at most two seconds and p95 at most five seconds when enough eligible episodes exist. Crossfire, hit rate and flag denial need explicit sample counts before drawing conclusions. These are tuning goals, not predeclared achieved results.

Use repeated level/player scenarios where possible to compare changes. Record the exact source revision, prompt version, configuration, player policy, terminated outcome, actual observation boundaries and spend before/after each batch. Ten trials cannot establish a human win rate or prove fun. Difficult, recoverable close calls and opportunities to misdirect or escape the squad still require human playtesting.

Artifacts belong under `test/validation/ai-mode/`, with recordings and screenshots tracked in Git LFS. Paid calls are run only by the lead after budget, roster and mock checks. Do not reset or replace the experiment ledger.

## Measured ten-game follow-up

The [ten-game report](test/validation/ai-mode/2026-10-01/REPORT.md) records three baseline games and seven revised games, exact calls/actions, browser recordings and a top-down mission replay. Revised first-shot medians were 0.77–1.20 seconds; tail latencies and unfired contacts still need work. Zero body contacts/friendly damage and no movement stall longer than 2.27 seconds were observed. The scripted player lost nine games and destroyed the squad in one; this does not establish human balance. Batch cost was $0.338845, cumulative $2.022747 on the preserved ledger.
