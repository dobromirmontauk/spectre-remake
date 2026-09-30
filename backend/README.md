# Optional local Jev backend

The static game continues without this process. Node 22+; no dependencies. Run alongside Vite:

```sh
JEV_ENV_FILE=/Users/dmontauk/src-personal/ai-projects/.env \
JEV_LEDGER_FILE=/Users/dmontauk/src-personal/ai-projects/spectre-remake/.jev-local/spend-2026-09-29.json \
node backend/server.mjs
```

Alternatively supply `TYPESAFE_API_KEY` through the environment. Keys remain server-side; `.env` is not automatically searched. `JEV_PORT` defaults to 8787, binding only `127.0.0.1`. `/health` (also `/api/jev/health`) returns key availability, spend, limit, attempted calls, and unsettled reservations. Startup diagnostics never print keys or upstream errors.

`POST /api/jev/decide` accepts `{version:1, sequence, tick, tanks:[{tankId, role:'enemy'|'player', observation:{...}, candidates:[{id, description}]}]}`. Limit four tanks, at most three enemies and one player; 16 candidates per tank. Tank IDs are safe short strings or nonnegative integers; candidate IDs additionally allow colon separators used by controller action IDs (for example `flank:enemy-2:-1`). Body limit 32 KiB, individual observations 6,000 JSON characters, descriptions 512 characters. Reply is `{sequence,tick,decisions:[{tankId,choice,confidence,probabilities}],usage:{inputTokens,costUsd},costUsd,spentUsd}`.

Browser batches are transport only. Each upstream request contains exactly one tank's observation and one fixed server-authored Choice question with an explicit tank reference. This prevents other commanders' perspectives leaking through the provider's shared state. Provider URL/model/auth and instructions cannot be selected by clients. Up to two provider calls run concurrently; at most two browser batches and six batches per second. Four tanks at 5 Hz need 20 provider requests/sec (documented provider limit 40); effective cadence depends on measured latency. Confidence is the provider's distribution metric, not verified tactical correctness.

Only localhost HTTP origins/Host are accepted. JSON is required. This is a local experiment, not a publicly deployable authenticated service. Provider timeouts are 1.5 seconds per request; no automatic retries. Invalid/failed/timed-out calls retain their full reserved cost. An entire batch may fail after earlier calls succeeded; those calls remain accounted for.

The **same absolute ledger file must be reused for the entire $10 experiment**, including restarts, worktrees, and later test runs. Default stop is **$9.50**, with headroom below $10. Before every paid call, atomically persist a 65,536-input-token reservation at $0.042/million ($0.002752512). Only validated successful usage refunds the difference; unknown usage is never forgiven. Ledger writes fsync then rename, including directory fsync. An exclusive `.lock` rejects a concurrent server. Do not remove, reset, or select a new ledger to evade the experiment cap. After a crash, the reservation remains charged; verify the lock PID is no longer running before manually removing only the stale `.lock`. Leave the ledger itself intact. Live ledger and lock belong in ignored `.jev-local/`, never git.

Run mocked tests (no provider calls):

```sh
node --test backend/*.test.mjs
```

Evidence: budget tests were first run before implementation and failed with missing module, then passed. Tests cover restarts, exclusive lock, budget reservations, timeout charging, maximum tank count, individual perception isolation, two-call concurrency, response validation, and CORS. No paid calls are part of this suite.

## Complete durable audit

Every upstream request is fsynced to JSONL before any model call, including its exact provider payload (model, individual perception, instructions and criteria), UTC timestamp, request sequence/tick/tank, globally unique `callId` and `recordId`. Every success includes the chosen option, probabilities, confidence, usage, cost and elapsed time; failures/timeouts retain reservation cost. Each successful decision in `/api/jev/decide` also carries `callId`. Partial batch failures do not suppress another tank's success evidence. Neither provider credentials/headers nor environment values are written. Fixed server error descriptions avoid printing upstream bodies.

The audit file defaults to `JEV_LEDGER_FILE + '.calls.jsonl'`; set **absolute** `JEV_AUDIT_FILE` only to select a persistent alternate file. Reuse the same file across restarts. Existing spend ledgers work unchanged; history starts when this audit-capable server begins running, and cannot reconstruct earlier calls. A separate exclusive audit lock prevents concurrent writers. An incomplete/corrupt existing file or an append/fsync failure disables paid calls. A request without completion becomes an `interrupted` record on restart, with its unknown cost conservatively shown as reserved. If startup fails after a crash, verify stopped PID before removing only stale locks; preserve both ledger and history.

Loopback endpoints share the same localhost Origin/Host restrictions:

- `GET /api/jev/history?offset=0&limit=50`: `{records,nextOffset,total}`, oldest first, maximum 200 records/page. Add `callId=<UUID>` to retrieve only that provider call’s request/result/error, with offset/total applying to the filtered records; missing IDs return an empty page.
- `GET /api/jev/history/export`: complete JSONL download.
- `POST /api/jev/audit/browser`: `{browserSessionId,sequence,tick,event:'attempt'|'response'|'outcome'|'applied',at:<ISO UTC>,details:{...}}`, at most 64 KiB. Persists a `type:'browser'` record with its own server UTC timestamp. This records browser stale/canceled/applied outcomes separately from provider outcomes, without inference or spending. Never include secrets in browser metadata.

The model payload remains bounded at 32 KiB, 6,000 observation JSON characters per tank, and 16 options; clients should compact level-map knowledge before crossing this boundary. Audit tests include restart interrupted calls, request/result pairing, partial batch failures, fail-closed logging, paginated export and mock-only browser metadata.
