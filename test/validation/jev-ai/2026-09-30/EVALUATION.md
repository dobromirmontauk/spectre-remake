# Jev tactical intelligence: local review, September 30

Final gameplay source: `84d64cc0f5ecb730df9e3ca7b09ac86c4640d8b6`. Backend during the final paid run included full successful envelopes and normalized provider headings; later error-audit handling was verified with mocks. The parent code pointer landed as `08dfdecc`. No production AI deployment.

## Final bounded live run

[Two-minute Level 5 video](level5/gameplay.mp4), [per-tick commands](level5/actions.json.gz), [state samples](level5/samples.json.gz), [exact browser calls](level5/decisions.json.gz), [summary and matching provider audit](level5/summary.json), [expanded live log](level5/real-log-expanded.png).

| Measure | Result |
| --- | --- |
| Configured / accepted decisions | 2 Hz / 1.90 Hz per tank |
| Model decisions | 900 |
| Batch latency p95 | 489 ms |
| Obstacle / tank contacts | 0 / 0 |
| Friendly-fire hits / damage | 0 / 0 |
| Non-firing stationary oscillation windows | 0 for all three enemies |
| Longest stationary intervals | 3.67 / 4.80 / 1.57 seconds |
| Flags collected / enemy kills / player deaths | 5 / 2 / 0 |
| Cumulative ledger, all iterations | $1.611858 of $10, hard stop $9.50 |

Enemies fired on their own current visual contact (305, 375 and 45 command ticks). Under-fire survival strategy counts were 192/234 and 203/225 for the two damaged enemies; the third had no under-fire ticks. One failed/canceled request around lifecycle start is retained, not counted as a successful decision. Provider perspectives matched captured browser inputs after only documented heading normalization. No paid retries.

## Earlier failures retained

- `initial-level5`: actual model/video data, but empty command recorder; marked explicitly. Peaceful regroup/guard choices led to long idle periods.
- `mock-trace-level2`: corrected recorder exposed overlapping spawns and margin scan jitter.
- `patrol-level5`: purposeful patrol appeared, but shared-only holds and static-margin deadlock remained.
- `failed-contact-level5`: actual crowding collision and a projectile hitting an ally beyond a dodging target. Exact failing-first physics fixtures now prevent both.
- `pre-hold-fix-level5`: zero contacts/FF, one oscillation window from expired scan/reacquire and an ally-blocked hold.
- `spacing-chatter-level5`: zero contacts/FF but 17 oscillation windows; full session reproduction exposed spacing-boundary motor chatter and the expired-plan integration omission.
- `normalization-check-level3`: video retained, but an obsolete equality assertion prevented action serialization; not a complete trace.
- `level3`: corrected one-minute record, zero contacts/FF/oscillation, 1.67 accepted Hz.
- `pre-final-level2`: one-minute record, zero contacts/FF/oscillation, 1.84 accepted Hz.

## Verification and limits

Lead independently ran build/purity, controller geometry/movement/full-session fixtures, actual session expiry, malformed browser response, personality lifecycle/distribution, full-flight friendly fire, backend/audit/budget tests and cross-engine determinism (20 matching checkpoints). Live Chromium verifies level-dependent perception, stale track headings/ages, stable collapsed/expanded logs and malformed-response fallback. `browser-repro.mjs` uses mocked provider responses; paid run scripts are separately labeled.

The final bounded run passed the measured safety and stationary-oscillation checks. Human fun, general win rate and all-map robustness remain unmeasured. Short stationary intervals can be deliberate combat/spacing, and raw turn reversals alone are not defects. The provider selects offered maneuvers; candidate quality and motor behavior are part of the AI. The complete local provider ledger/audit remains ignored and is never reset or committed. Recorded examples redact authorization; an exact-key scan of saved artifacts found no occurrences. After late-call settlement and backend restart, health reported $1.612480 cumulative spending with zero pending reservations. The user approved committing these records under `test/validation/` on September 30, 2026.
