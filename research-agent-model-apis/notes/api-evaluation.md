# Jev and Luna Decisions: API evaluation — 2026-09-29

## Findings from official sources

Jev is TypeSafe AI’s specialized decision model. Its documented evaluation route is `POST https://api.typesafe.ai/v1/systemone`, with Bearer authentication and JSON fields `model`, `state`, and `questions`. State may be text, an object, or an array. Noul answers yes/no with a probability; Choice selects from supplied options and returns their probabilities plus distribution-derived confidence; Score evaluates an ordered rubric. These are bounded decisions, not generated tactics, text, or code. Question IDs are not seen by the model, so instructions must explicitly identify the relevant tank. Source: https://docs.typesafe.ai/api .

Pin `jev-1.13.0` for reproducible evaluation. Current documented limits: 40 requests/second, 100K tokens/second; 64K total request context and 32K state plus longest question. Text only; no images, audio, or video. Input costs $0.042/million tokens; output is free. Limits may change with demand. Source: https://docs.typesafe.ai/models .

Choice supports up to 255 options. Multiple questions are evaluated in parallel against shared state, with little added latency but additional token cost. Independent per-tank questions do not constitute a coordinated joint squad plan; compute role assignments in code or offer a finite set of complete squad plans. Confidence describes the probability distribution, not independently validated correctness in Spectre. Source: https://docs.typesafe.ai/primitives/choice .

TypeSafe reports 70–500 ms end-to-end latency, with measurements generally on West Coast laptops near its service, and demonstrates Doom at ten queries/second using structured textual state rather than screenshots. The vendor also says a non-AI Doom bot could play better. This makes 5–10 Hz a plausible experiment, not a guaranteed production rate. Source: https://typesafe.ai/blog/introducing-system-one-models-and-jev .

OpenAI announced a Luna-powered Decisions API on September 29: predefined finite answers to developer questions, with text or image context. Limited preview today; broad release planned in coming days. The official announcement does not provide a model ID, endpoint, auth contract, request/response schema, latency number, pricing, image limits, or rate limits. Public developer docs searches did not establish those details. Do not invent a `/v1/decisions` route or reuse regular Luna prices as Decisions prices. Source: https://openai.com/index/devday-2026-recap/ .

Ordinary `gpt-6-luna` is separately documented as a text/image generative model. Its Responses API, reasoning settings, and token prices are not evidence for the specialized Decisions API contract. Source: https://developers.openai.com/api/docs/models/gpt-6-luna .

## Backend and Spectre integration proposal

The current static Pages deployment cannot privately hold a shared provider API key. Add one Cloudflare Worker as a thin backend; retain static game hosting. Browser posts a bounded snapshot to Worker, Worker validates session/size/frequency, builds fixed server-controlled questions, calls the provider with a secret, normalizes decisions, returns snapshot tick/sequence/expiry. Origin checks/CORS are not authentication. For a private experiment use authenticated access; for a public mode enforce per-session and global budgets. No Durable Object is needed merely to proxy inference, but one can coordinate strict global quotas or room state.

Start with Jev and structured state, because Spectre already knows coordinates, visibility, collision geometry, and health. Compare Luna on identical textual inputs once access exists, then separately compare image input from a bot-perspective screenshot or tactical map. Equalize visible information; avoid giving the text model hidden entities while restricting the image model to the screen. Include recent observations because a single image cannot establish velocity.

Prototype single-player first, with 2 Hz / 5 Hz / 10 Hz decision targets. Maintain 30 Hz simulation. At most one in-flight call initially; apply a finite tactical action until expiry, discard stale/old-match responses, and use deterministic fallback on timeout. Tighten cadence only after measuring total browser→Worker→provider→browser p50/p95/p99, including image capture/upload and multi-question payloads. Do not freeze the sim to wait for inference. Local physics/steering and legal-action constraints remain necessary.

For enemy replacement, `simulation.ts` currently calls `enemyCommand` internally rather than consuming external player commands for enemies. Add a serializable tactical-input boundary; keep fetches and timers outside `sim/`. Preserve cooldown/unstick bookkeeping and bounded turn/thrust commands. Multiplayer later requires one authority to distribute plans at agreed ticks with an acknowledgement/late-message policy; all peers must use identical accepted plans and fallback. Record applied plans for deterministic replay.

Illustrative Jev inference-only cost for a whole-squad request with 1,500 input tokens: 2 Hz = $0.4536/player-hour, 5 Hz = $1.134, 10 Hz = $2.268. Repeated instructions/options are included in input usage; actual serialized requests can be larger. These figures exclude Worker hosting, retries, and any image preprocessing. At 10 Hz, the currently documented 40 RPS limit supports only four concurrent games on request count alone, with no headroom. Query-per-tank multiplies this cost and capacity requirement.

## Next experiment

Obtain Jev access and benchmark 1/4/12-question payloads on recorded game situations; measure latency, policy oscillation, useful decisions, failure rate, input usage, and cost. Compare with existing FSM and a scripted squad baseline across fixed seeds. Benchmark Luna Decisions when its official contract and account access are available. No implementation or paid API calls occurred in this research session.
