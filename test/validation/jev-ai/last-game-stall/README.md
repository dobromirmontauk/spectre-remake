# Last-game flag patrol deadlock

Source code: `063752b`. Browser session `59f080a2-aea5-4928-b9ef-5be02658f15d`; latest reset segment began 2026-10-01 01:44:38 UTC (September 30, 18:44:38 Pacific), ending at simulation second 84. This is the user's latest logged Level 1 game, not the earlier Level 5 validation film. No paid calls made for diagnosis.

## What happened

Two enemies lost player contact, returned to known flag `flag-4`, and selected opposite patrol directions. Enemy 1 last had nonzero speed at 36.73 seconds; Enemy 2 at 37.23 seconds. Both then remained at speed zero through second 84, with unchanged headings and positions reconstructed from each other's direct sightings. Four flags remained. Each tank's final 85 applied provider choices was the same patrol ID (about 42 seconds at 2 Hz). Across the final game, 159/167 accepted choices for Enemy 1 and 154/167 for Enemy 2 were patrol choices. Browser `applied` records can be saved more than once; these counts deduplicate by provider `callId`.

| Tank | Actual position from ally's sighting | Selected choice | Destination | Destination distance from ally |
|---|---|---|---|---|
| Enemy 1 | (-3.647, 85.225) | `patrol:flag-4:-1` | (-6.438, 72.665) | 1.749 units |
| Enemy 2 | (-8.044, 73.357) | `patrol:flag-4:1` | (-6.342, 87.546) | 3.557 units |

Final provider probabilities were 0.78 and 0.68 for those patrol choices. Candidate descriptions said “continuously survey for opponents” and “known obstacle route clear.” The tanks were healthy, had no current player contact, and were **not** choosing hold or regroup.

## Confirmed cause

`buildCandidates` checks patrol waypoints against arena bounds and known obstacles, but its ally-destination exclusion applies only to engage/flank/intercept choices. Both patrol waypoints sit near the other tank. `commandForPlan` correctly prevents an unsafe approach, producing `{turn:0, thrust:0, fire:false, grenade:false}` for **both** recorded poses. With only the other enemy removed, the identical plan returns forward thrust 1. The mismatch allows a plan described as continuous patrol to become indefinite idle.

At their approximately 12.7-unit separation, the close-hull recovery threshold (6.5 units) does not activate. Jev receives speed and last strategy but no elapsed stall duration, failed waypoint, executor block reason or sustained-progress history. It repeatedly selects the still-offered blocked route. A nearest-flag preference and no allocation of separate defense sectors compound the clustering. More aggressive prompting alone would not fix the physical deadlock.

A secondary telemetry issue: these body-blocked moves increment `wallAvoided`, because the counter's short ray misses the distant blocking ally although the longer prediction rejects it. Thus existing aggregate safety counters can misidentify this stall.

## Reproduce without model calls

From repository root, with a Node version supporting TypeScript stripping:

```sh
node test/validation/jev-ai/last-game-stall/reproduce.mjs
```

This reconstructs enemy poses from their own headings/speeds and their ally's exact direct sighting, uses the deterministic Level 1 arena, places the unseen player far away, builds the recorded candidate, and compares the actual controller command with/without the ally. It is a local controller reproduction, not a full replay of the human's inputs; the persistent logs do not contain a full 30 Hz human action trace for this game.

`evidence.json` contains the final exact browser request, final provider results, and the 168 request-time observations for this reset segment. The original provider/spend ledger is preserved and not committed.

## Recommended correction

Filter or reroute blocked patrol paths using currently observed allies; offer both orbit directions instead of accepting the first obstacle-clear one. Report own stalled duration and executor block reason to the commander, and temporarily suppress a repeatedly unsuccessful waypoint. Add a bounded local movement recovery that preserves collision safety. Encourage separate visible defense sectors rather than the same nearest flag, while retaining Level 1 knowledge limits. Verify with this recorded fixture and another live human game before claiming the behavior is fixed.

**Status: diagnosed and reproduced; gameplay code has not been changed.**
