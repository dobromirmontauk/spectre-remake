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

The commander receives its own position, heading, speed, shield fraction, ammo and cooldown; contacts within 65 units, a 234-degree forward arc and unobstructed line of sight; visible obstacle geometry or four-unit tactile geometry; and only its own timestamped previous sightings and visited trail. It does not receive the whole simulation, RNG, hidden objectives, opponent health/ammo, other commanders' perspectives, or unseen current target positions. Last-seen moving opponents are not indefinite pursuit targets. Unrelated unseen respawns do not erase another commander's memory.

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
