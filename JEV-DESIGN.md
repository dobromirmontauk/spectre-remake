# Optional Jev commander

## Local operation

The static game starts with scripted AI and requires no backend. **Jev AI** enables the local experiment; **Player autopilot** also hands the main tank to Jev. Both are opt-in. Jev is restricted to visible, unpaused, local single-player games and at most three enemies plus one player. Decisions default to **2 Hz**, per the user's test direction. There is no production AI deployment in this experiment.

Run `npm run dev -- --host 127.0.0.1` and the optional process documented in [backend/README.md](backend/README.md). Keys stay in the server process. Reuse the same absolute ledger across every restart/worktree: `/Users/dmontauk/src-personal/ai-projects/spectre-remake/.jev-local/spend-2026-09-29.json`. The server stops paid calls at $9.50, below the authorized $10. Unknown usage, failures and timeouts retain the maximum reservation. Never reset the ledger to continue testing.

## Commander decision tree

```mermaid
flowchart TD
    A[Visible local solo game with Jev enabled] --> B[Each living tank observes its own surroundings]
    B --> C[Generate up to 16 known local maneuvers]
    C --> D[Browser sends a transport batch at 2 Hz]
    D --> E[Backend reserves cost separately for each tank]
    E --> F[One isolated Jev Choice request per commander]
    F --> G{Response still belongs to this life and level?}
    G -->|yes| H[Apply selected local plan]
    G -->|no or unavailable| I[Safe local coast or survey]
    H --> J[30 Hz steering, braking, spacing and shot checks]
    I --> J
    J --> K[Deterministic simulation and physical event metrics]
```

Jev chooses a finite maneuver, not arbitrary controls or executable code. Player choices include collecting known flags/supplies, engaging, flanking, retreating and exploring. Enemy choices include attacking/flanking/retreating, searching for opponents and guarding a locally known flag. Enemies receive no collection tasks. The executor checks movement and firing each simulation tick; model choice quality and executor safety are measured separately.

## Information boundary

The commander always has its own operating status, public total/remaining flag counts, and local vision: contacts within 65 units, a 234-degree forward arc and unobstructed line of sight, plus visible obstacle geometry or four-unit tactile geometry. Intelligence deliberately expands with campaign level:

| Level | Authorized map and squad knowledge |
| --- | --- |
| 1–2 | Individually observed objectives; remembered flag coordinates are approximate. No advance objective list or hidden live opponent tracking. |
| 3–4 | Exact own map location and advance positions of typed flags, ammo and shield items. Visibility still limits opponent sightings. |
| 5+ | Other AI tank locations and their last accepted strategy. Enemy commanders receive the player's current sighting only while at least one enemy can see the player. |

Tank tracks record their last observed position and heading, observation tick/time, age relative to the current game time, and whether the sighting came from the commander or a shared spotter. Hidden moving targets retain their last observation; they do not acquire fresh coordinates or headings merely because game time advances. No tier reveals opponent health/ammo, RNG or the complete simulation.

Enemy mission instructions explicitly say to stop the player taking their flags. Two or fewer remaining flags increase interception urgency without bypassing survival or safety rules. Healthy enemies without a visible opponent receive progressing patrol/exploration choices; automatic idle guarding and peaceful regrouping are excluded after recorded tests showed long stationary stretches. Enemies without a visible opponent should patrol a defensive circuit around a known flag and look outward for the player. Protecting a flag remains a distinct deliberate choice. Recent incoming fire and low shield prioritize retreat or regrouping over pursuit. Tactical strategy and maneuver are recorded separately, so several local maneuvers can implement the same survival or patrol strategy.

Each upstream request contains **one tank's perspective only**. Multiple Jev questions share state, so combining all perspectives into one provider call would violate the boundary. Browser batching saves local transport overhead only. At four tanks and 2 Hz, the nominal load is eight provider calls/second. Two upstream calls may run concurrently.

Collision and firing guards use the local physical scene to brake and reject unsafe shots. They cannot choose a hidden objective or use a hidden target's new position to steer. This separation is deliberate: Jev selects tactics from limited knowledge; reflexes prevent immediate physical mistakes. Nearby moving bodies require relative-motion prediction; replanning must preserve a viable braking trajectory. Friendly-fire safety checks the actual projectile heading, including the enemy's post-movement heading. Normal weapon cooldowns still apply.

## Evaluation and fun hypotheses

Run `node scripts/jev-evaluate.mjs --enabled=true --autopilot=true --hz=2 --level=3 --duration=90 --video=true --output=reference/verification/jev/<run>` only after reviewing the backend cap. God mode stays off. The harness stops for roster violations, game over or budget exhaustion. Requested seeds are recorded but **not applied**; the game's built-in deterministic level seeds are used. No multi-seed win-rate claim is warranted yet.

| Measure | Desired result / interpretation |
| --- | --- |
| Accepted decisions per living tank-second | Approximately 2 Hz; aim for at least 1.8 Hz |
| Complete batch latency | p95 below 500 ms for the 2 Hz interval |
| Model command coverage | At least 95%; fallback is counted separately |
| Physical obstacle/tank contacts and friendly damage | Zero in acceptance runs; interventions are not collisions |
| Flags, kills, level clears, damage and life losses | Demonstrate real progress and enemy pressure without invulnerability |
| Applied maneuver categories | Purposeful objectives, attack/flank/retreat/search; no enemy supply chase |
| Stationary time and progress gaps | Inspect extended inactivity; deliberate firing/guarding differs from a deadlock |
| Recoverable close calls | Player reaches <=25% shield and escapes/heals without a life reset |
| Human win rate and fun | Hypothesis: 40–70% wins after practice, meaningful tactical choices and close calls; requires repeated varied trials and human play |

Tick events measure actual contacts/damage. Trajectory distance, stationary seconds and low-shield recoveries are explicitly sample-derived from 200 ms snapshots. A death/respawn is not a recovery. Autopilot is a test opponent, not a human fun rating. Safety regression tests and watchable gameplay are required alongside build/test success.

## Evidence

Reports and gameplay are in [reference/verification/jev/](reference/verification/jev/). Each compact report has a companion `samples.json.gz` preserving its full sampled state for reproduction. Failed and intermediate runs are retained, including the original HTTP400 wire mismatch, a spacing deadlock, dynamic tank contacts and a windmill impact. Later acceptance evidence must be read against the exact code revision and configuration recorded in the evaluation summary.

## Decision audit and live log

Every new upstream call is saved locally before transmission, then completed with its result or error. Entries include UTC timestamps, game tick, tank identity, exact provider state/instructions/choices, selected choice, confidence, usage and cost when available. An unmatched start after interruption remains visibly pending/unknown. Credentials and authorization headers are excluded. The audit is persistent across server restarts and separate from the cumulative spending ledger; it must not be reset during testing.

The live decision window presents concise tank/strategy/maneuver summaries with latency and outcome. Exact input state and options are collapsed by default and expandable per call. Model choices, browser application/staleness and local fallback are distinguished; summaries describe supplied choices rather than inventing model reasoning. The visible list is bounded for responsiveness, while the durable backend history preserves every recorded call. Logging begins with this version; previous calls cannot be reconstructed from aggregate spending statistics.

## September 30 review refinements

Enemy personality is assigned per life with 60% aggressive, 20% neutral and 20% cowardly probability; the player autopilot is neutral. The personality draw is outside the pure simulation RNG and persists across pause/configuration. Risk preferences never override survival or physical safety. The exact commander observation includes the assigned personality.

The local controller forecasts moving-body separation independently of short static route checks, considers a peer braking abruptly, and rejects offensive destinations crowded by known allies. A turn deadzone accounts for the actual per-tick turn increment. Stationary holds are unavailable when a fresh known friendly occupies their firing corridor. A six-tick neutral grace during brief plan expiry avoids scan/reacquire oscillation; it disables firing, retains physical guards, and then resumes fallback scanning.

Friendly-fire safeguards check the shell's full flight, including allies beyond a dodging target and reachable movement during flight. Enemy firing rechecks the actual post-movement muzzle pose. These safeguards preserve normal weapon cooldowns and the unchanged normal simulation.

Provider instructions state horizontal x/z game units, signed speed per second, headings in radians (0 toward +z, pi/2 toward +x), and 30 simulation ticks per second. Only the provider copy normalizes tank headings; simulation steering is unchanged. Approximate early coordinates and observation ages are explicitly explained. Candidate descriptions promise checks against known geometry, never guaranteed future safety.

Every parsed provider response envelope is retained with the request and result/error, without authorization headers. Legacy extracted-only records are not reconstructed. Malformed browser responses are rejected before usage counters update; invalid JSON text is retained for review. All calls use the same persistent cumulative ledger and conservative unknown-cost accounting.

Spacing recovery retains a chosen escape direction until nine-unit clearance, with a 120-tick maximum lifetime and level/rollback/lifecycle resets. It lives only in local controller memory, outside provider observations and pure simulation state. Actual session regressions cover the motor memory and expired-plan grace, rather than only isolated controller calls.

Approved September 30 recordings, exact example calls and review reports: `test/validation/README.md` and `test/validation/jev-ai/2026-09-30/EVALUATION.md`. This directory is validation evidence, not runtime code or deployment assets. The user approved its repository publication.

## Separate AI mode (2026-10-01)

The [AI-mode contract](AI-MODE.md) adds finite per-level lives and a central squad mission layer. In this mode commanders choose short tactical actions at 2 Hz; they cannot replace their assigned mission. Normal solo/local/network behavior is preserved. See the [ten-game evaluation](test/validation/ai-mode/2026-10-01/REPORT.md) for measured outcomes, costs, raw calls and recordings. Historical individual-strategy experiments below remain prior evidence rather than the current AI-mode contract.
