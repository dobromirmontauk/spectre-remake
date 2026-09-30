# Optional local Jev backend

The static game continues without this process. Node 22+; no dependencies. Run alongside Vite:

```sh
JEV_ENV_FILE=/Users/dmontauk/src-personal/ai-projects/.env \
JEV_LEDGER_FILE=/Users/dmontauk/src-personal/ai-projects/spectre-remake/.jev-local/spend-2026-09-29.json \
node backend/server.mjs
```

Alternatively supply `TYPESAFE_API_KEY` through the environment. Keys remain server-side; `.env` is not automatically searched. `JEV_PORT` defaults to 8787, binding only `127.0.0.1`. `/health` (also `/api/jev/health`) returns key availability, spend, limit, attempted calls, and unsettled reservations. Startup diagnostics never print keys or upstream errors.

`POST /api/jev/decide` accepts `{version:1, sequence, tick, tanks:[{tankId, role:'enemy'|'player', observation:{...}, candidates:[{id, description}]}]}`. Limit four tanks, at most three enemies and one player; 16 candidates per tank. IDs are safe short strings or nonnegative integer tank IDs. Body limit 32 KiB, individual observations 6,000 JSON characters, descriptions 512 characters. Reply is `{sequence,tick,decisions:[{tankId,choice,confidence,probabilities}],usage:{inputTokens,costUsd},costUsd,spentUsd}`.

Browser batches are transport only. Each upstream request contains exactly one tank's observation and one fixed server-authored Choice question with an explicit tank reference. This prevents other commanders' perspectives leaking through the provider's shared state. Provider URL/model/auth and instructions cannot be selected by clients. Up to two provider calls run concurrently; at most two browser batches and six batches per second. Four tanks at 5 Hz need 20 provider requests/sec (documented provider limit 40); effective cadence depends on measured latency. Confidence is the provider's distribution metric, not verified tactical correctness.

Only localhost HTTP origins/Host are accepted. JSON is required. This is a local experiment, not a publicly deployable authenticated service. Provider timeouts are 1.5 seconds per request; no automatic retries. Invalid/failed/timed-out calls retain their full reserved cost. An entire batch may fail after earlier calls succeeded; those calls remain accounted for.

The **same absolute ledger file must be reused for the entire $10 experiment**, including restarts, worktrees, and later test runs. Default stop is **$9.50**, with headroom below $10. Before every paid call, atomically persist a 65,536-input-token reservation at $0.042/million ($0.002752512). Only validated successful usage refunds the difference; unknown usage is never forgiven. Ledger writes fsync then rename, including directory fsync. An exclusive `.lock` rejects a concurrent server. Do not remove, reset, or select a new ledger to evade the experiment cap. After a crash, the reservation remains charged; verify the lock PID is no longer running before manually removing only the stale `.lock`. Leave the ledger itself intact. Live ledger and lock belong in ignored `.jev-local/`, never git.

Run mocked tests (no provider calls):

```sh
node --test backend/*.test.mjs
```

Evidence: budget tests were first run before implementation and failed with missing module, then passed. Tests cover restarts, exclusive lock, budget reservations, timeout charging, maximum tank count, individual perception isolation, two-call concurrency, response validation, and CORS. No paid calls are part of this suite.
