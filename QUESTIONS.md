# QUESTIONS

## Open

None.

## Resolved

### 2026-09-30 — Publish live AI test evidence to repository

**Context:** Automatic approval review rejected a combined commit/push of `test/validation/jev-ai/2026-09-30/` because it includes full provider prompts/responses and detailed game telemetry; no credentials are included. Source changes continue independently.

**Question:** May the gameplay videos, action traces and provider examples be committed and pushed to the spectre-remake GitHub repository, or should they remain local?

**Blocking:** Remote evidence handoff and cleanup of the isolated verification worktree.

**Answered 2026-09-30:** User approved committing the recordings, traces and full Jev call examples, and requested a `test/validation/` folder structure so they are clearly separate from the main application. Reflected in `test/validation/README.md`, artifact commit `0e9a025`, and `TODO.md`.

### 2026-09-29 — Identify Jev and fast Luna

**Context:** User requested research on replacing Spectre’s enemy AI using “Jev” and “fast Luna.” These identifiers are not defined in the project and a public search did not establish their identities.

**Question:** Which models or services do these names refer to? Provide exact names or links.

**Blocking:** Provider-specific API, pricing, latency, and deployment evaluation. Architecture analysis can proceed independently.

**Answered 2026-09-29:** User directed us to look up Jev’s ~100 ms decision model and newly launched image-capable Luna equivalent. Official research identifies TypeSafe AI Jev and OpenAI’s Luna-powered Decisions API. API findings: `research-agent-model-apis/notes/api-evaluation.md`.


### 2026-09-29 — Cloudflare authentication

**Context:** Production build is ready, but `wrangler whoami` reports that the saved Cloudflare login is no longer authenticated. `wrangler login` opened the authorization page in the user’s browser.

**Question:** Please authorize Wrangler in the browser and confirm when complete.

**Blocking:** Cloudflare Pages deployment in TODO.md.

**Answered 2026-09-29:** User authorized Wrangler in the browser and confirmed “done.” Authentication succeeded and the site was deployed.
