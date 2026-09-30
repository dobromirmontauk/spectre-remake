# Test and validation evidence

This directory contains recorded experiments and review artifacts. Nothing here is imported by the game or included in the production build.

## Jev AI — September 30, 2026

Start with the [evaluation report](jev-ai/2026-09-30/EVALUATION.md).

- [Full example request and provider response](jev-ai/2026-09-30/example-call-full-response.json), with authorization redacted.
- [Final Level 5 gameplay video](jev-ai/2026-09-30/level5/gameplay.mp4).
- [Final per-tick actions](jev-ai/2026-09-30/level5/actions.json.gz), [state samples](jev-ai/2026-09-30/level5/samples.json.gz), and [browser decision history](jev-ai/2026-09-30/level5/decisions.json.gz). Gzip files contain JSON.
- Earlier failed runs and recorder limitations are retained for comparison; see each run's summary or limitation note.

`browser-repro.mjs` exercises the live UI with mocked model responses. `realism-play.mjs` records manual bounded experiments against the development server on port 5183; its default uses the local paid backend. `MOCK_JEV=1` selects mocked decisions. Neither script runs automatically during the game build or ordinary tests. Use the existing persistent ledger, 2 Hz cadence and maximum three enemies plus one player for any paid rerun; never reset the cumulative $10 test ledger.

The complete local spend ledger, API credentials and continuously growing provider audit are excluded from git. Saved call examples and selected audit records are game-only data.
