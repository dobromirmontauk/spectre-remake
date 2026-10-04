# Spectre: a browser remake with fast AI tank commanders

Project summary · September 30, 2026

We rebuilt the 1991 tank game Spectre for the browser, then explored a question: can a fast decision model make its opponents more purposeful while giving each tank only the information its commander should know?

The resulting game supports single-player campaigns, local two-player co-op and duels, and network multiplayer for up to eight players. It is built with TypeScript and Three.js around a deterministic simulation running at 30 ticks per second. The [public browser game](https://spectre-remake.pages.dev/) is hosted on Cloudflare Pages. The Jev AI experiment is an optional, locally tested single-player mode; it has not been deployed to that public site.

## Two loops: tactics and execution

Each AI tank asks Jev for a tactical decision at a configured rate of twice per second. The game generates up to 16 candidate maneuvers from the tank's permitted observations. Jev selects a candidate; local code translates it into steering, acceleration, braking, aiming and firing at 30 Hz.

That division gives the model useful decisions to make—patrol a flag, explore, intercept an opponent, flank, retreat or regroup—while keeping immediate physical control responsive. The local executor checks stopping distances, moving tanks and projectile paths. A model-selected action can still be slowed or vetoed by those guards.

The browser sends requests through an optional backend, which holds the API key, records calls and enforces a persistent spending limit. Each upstream request contains exactly one commander's perspective. Four tanks can share a browser transport batch, but their observations are separated before contacting Jev. The backend allows two upstream calls in flight at once. The player tank can also use Jev autopilot, making automated gameplay trials possible with at most three enemies and one player.

## Limited knowledge, increasing coordination

Information expands as the campaign becomes harder:

| Level | What the commander knows |
| --- | --- |
| 1–2 | Its local observations and remembered sightings; own navigation and known objective coordinates are approximate. No advance objective map. |
| 3–4 | Exact own position and an advance map of flags and typed ammo/shield supplies. Opponent sightings still depend on vision. |
| 5+ | Other AI tanks' positions and last strategies. The player's current position is shared among enemies only while an enemy actually sees the player. |

Moving contacts carry their last observed position, direction, timestamp and age. A tank that disappears does not quietly receive a fresh location. Commanders get the public remaining-flag count and a mission to stop the player collecting their flags, with increased urgency near defeat. Healthy tanks patrol or explore; recent fire and low shields make retreat and regrouping relevant.

Enemy personalities are drawn per life: 60% aggressive, 20% neutral and 20% cowardly. Those are assignment probabilities, not a guaranteed mix in every three-tank squad. Personalities change risk preference while retaining survival and safety constraints. The player autopilot is neutral.

## Where performance ended up

The final recorded Level 5 trial ran for two minutes with three Jev enemies and a Jev player. Invulnerability was off. These are measurements from that bounded trial, not averages across a large benchmark:

| Measure | Final result |
| --- | --- |
| Configured decision cadence | 2 Hz per tank |
| Accepted decisions per living tank-second | 1.90 Hz |
| Accepted model decisions | 900 |
| Full four-tank batch latency, median / p95 | 378 ms / 489 ms |
| Command ticks with a valid model plan | 98.0%; remaining ticks used local fallback |
| Obstacle contacts / tank contacts | 0 / 0 |
| Friendly-fire hits / damage | 0 / 0 |
| Detected non-firing stationary oscillation windows | 0 for all three enemies |
| Longest stationary intervals, by enemy | 3.67 / 4.80 / 1.57 seconds |
| Player flags / enemy kills / player life losses | 5 of 10 / 2 / 0 |

The enemies issued firing commands when they had their own visual contact. Across the two enemies that experienced the recorded threat condition, retreat/regroup strategies were active for about 86% of under-fire or low-shield command ticks. The player spent approximately 3.3 simulation seconds below 25% shield. That is evidence of pressure, not proof of a good human difficulty curve. The final trial did not clear the level.

A saved individual Jev call took 121 ms. That is one example, not a measured median for the provider. The batch figures include the path needed to obtain decisions for the four commanders. Earlier trials averaged 1.60–1.84 accepted Hz and sometimes exceeded the 500 ms p95 target. We ended with a successful approximately-2-Hz trial; consistently meeting that cadence across conditions still needs broader testing. We did not establish 5 Hz operation or benchmark graphics frame rate.

## Cost: cheap calls still accumulate

The final run reported 3.49 million input tokens across 900 decisions, averaging approximately 3,880 tokens per decision. At the **$0.042 per million input tokens recorded for this experiment**, successful calls in that run cost **$0.1466**. The persistent ledger ended the iteration at **$1.6125 total**, including previous trials and conservative accounting for calls with unknown usage. Testing was authorized up to $10, with a $9.50 backend hard stop preserved across restarts.

Using that recorded token footprint and rate, nominal continuous operation at 2 Hz would cost roughly:

| Jev-controlled tanks | Estimated cost per hour |
| --- | --- |
| One tank | $1.17 |
| Three enemies plus an AI player | $4.69 |
| Six enemies, human-controlled player | $7.04 |
| Six enemies plus an AI player | $8.21 |

These are extrapolations, not hour-long measurements or current pricing guarantees. They exclude backend hosting and extra costs from failures with unknown usage. Early levels had smaller inputs; map and squad information increased the context size. Compact state descriptions and a shorter repeated prompt are worthwhile next optimizations.

## What improved the behavior

The most useful debugging came from recording decisions **and** their execution. Several failures required changes outside the prompt:

- Tanks initially chose peaceful regrouping or idle guarding too often. Restricting healthy, unseen-opponent choices to progressing patrol and exploration removed those unproductive options.
- A squad report could produce a stationary firing hold even when the commander lacked its own view. Shared sightings now support movement; firing requires the tank's own current visual contact.
- Some holds had a visible teammate in the firing corridor. The safety guard withheld fire, but the tactic remained poor. Those blocked stationary holds are now excluded so the model can choose moving alternatives.
- Collision prediction missed a leading tank braking suddenly. The controller now accounts for peer braking as well as continued movement.
- Shots could miss a dodging target and hit an ally farther along the path. Firing guards now check the projectile's full flight and reachable ally movement, including the post-movement muzzle pose.
- Tanks could oscillate at the spacing boundary, or scan away during brief plan expiry and immediately turn back. Bounded spacing recovery and an expiry grace period fixed reproduced cases through the actual session and simulation path.

One recorded two-tank spacing fixture changed from 57/56 detected oscillation windows to zero. Over six seconds, the tanks traveled about 29/51 units instead of about five each, without introducing contacts or friendly fire. These are regression-fixture results; the final live trial separately recorded zero oscillation windows.

The lesson is that the observation boundary, available choices and local executor jointly determine behavior. Better instructions help, but the model needs useful choices and stable execution.

## What remains—and how to pick this up later

The final trial passed the measured safety and stationary-oscillation checks. We have not established human enjoyment, a reliable win rate, superiority over scripted AI in a controlled comparison, or robustness across all maps. Human playtests should focus on understandable enemy intent, recoverable close calls and whether winning requires smart decisions. Other decision models, including Luna, remain unbenchmarked here.

Every new provider call and parsed response is audited locally with timestamps, usage and outcomes; the browser separately records acceptance and execution. A live decision window presents short summaries with exact state collapsed by default. Failed runs and recorder limitations are preserved alongside successful evidence.

The next publication step is to adapt this summary into a blog or LinkedIn post for review. A public AI backend would be a separate deployment decision requiring authentication and shared budget control. The browser game is already available; the model experiment remains local.

For future work, start with these records:

- [Validation index](test/validation/README.md), including earlier failed runs and the final video.
- [Detailed evaluation](test/validation/jev-ai/2026-09-30/EVALUATION.md) and [full example request/response](test/validation/jev-ai/2026-09-30/example-call-full-response.json).
- [Design and information boundaries](JEV-DESIGN.md), [backend operation](backend/README.md), and [current TODO](TODO.md).

The final gameplay measurements correspond to source revision `84d64cc`. Evidence was archived in `0e9a025`; the design and handoff were recorded in `f4956d8`. All validation artifacts live under `test/validation/`, outside the game bundle. Normal simulation determinism remained intact, with 20 matching checkpoints across V8, JavaScriptCore and SpiderMonkey. Preserve the existing cumulative ledger before any new paid experiment.


A [48-second group-combat video](test/validation/jev-ai/group-tactics/group-tactics.mp4) presents the real Level 5 trace as a readable tactical replay, including retreat and regroup choices. The [original capture](test/validation/jev-ai/2026-09-30/level5/gameplay.mp4) is available alongside it. This is evidence of those behaviors, rather than proof of coordinated flanking.

## AI mode and squad missions — 2026-10-01

A separate AI mode now enables Jev with one player life per level and a finite enemy squad. The squad planner owns search, hunt, intercept, attack and recovery missions; individual tanks select tactical actions within those missions at 2 Hz. Shared sightings carry timestamps, and withdrawal can keep a gun on a personally visible opponent while backing toward safety. Original game modes retain their existing behavior.

Ten real model-backed games covered Levels 1, 3 and 5, with three paired baseline/revised flag-rush cases plus evasion/hunting cases. The revised runs recorded first-shot medians of 0.77–1.20 seconds, zero body contacts and friendly damage, and no assigned-movement stall longer than 2.27 seconds. Nine scripted-player deaths and one complete squad defeat show pressure and a viable winning route, but do not establish human fairness. Long firing delays and unfired contacts remain measurable weaknesses. The batch cost $0.338845; cumulative experiment spend is $2.022747. Full ten-metric definitions, limitations, exact calls/actions and videos are in the [evaluation report](test/validation/ai-mode/2026-10-01/REPORT.md).
