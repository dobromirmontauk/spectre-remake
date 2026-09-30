# Roadmap

## Current Objective

Evaluate model-controlled enemies using the user’s proposed Jev / fast Luna options; retain the blog / LinkedIn announcement as the next publishing task.

## Next Steps

- [x] Identify Jev and Luna Decisions APIs; documented verified capabilities, pricing, limits, and unknown Luna preview contract in `research-agent-model-apis/notes/api-evaluation.md`.
- [ ] Obtain provider access and benchmark Jev at 2/5/10 Hz; add Luna Decisions when its official contract and account access are available.
- [ ] Benchmark squad-level model tactics against the existing FSM and an improved deterministic squad baseline before deciding on implementation.

- [ ] **Publish a blog post / LinkedIn post about Spectre.** Include the live game link, a gameplay screenshot, the inspiration from the 1991 Mac game, and local/network multiplayer. Draft for user review before posting.

## Last Progress

- 2026-09-29 — Researched official Jev API and newly announced Luna Decisions API; revised experiment to bounded action selection at measured 2–10 Hz, via a Cloudflare Worker backend. Jev text-only, vendor latency 70–500 ms; Luna Decisions image support confirmed but public schema/pricing/latency not found. Raw sources and synthesis in `research-agent-model-apis/`. Supersedes the earlier generic two-second LLM-plan proposal.

- 2026-09-29 — AI architecture evaluation: `src/sim/ai.ts` pursues nearest players, leads shots for hunters, and reverses when stuck; `simulation.ts` invokes it internally for every enemy rather than using the external player command map. Sim runs at 30 Hz with 2–12 enemies. Recommended experiment: one squad plan every 2 seconds, deterministic steering/aiming each tick, single-player first, model calls outside the sim via a Cloudflare Worker. Multiplayer needs host-authoritative plans scheduled and acknowledged at identical ticks (including fallback); never independent calls per peer. Benchmark complete-response p50/p95 latency, stale/invalid outputs, win rate, stuck time, and cost per player-hour. At one squad call / 2s: 1,800 calls/player-hour; illustrative 1,500 input + 200 output tokens/call = 2.7M input + 0.36M output tokens/hour. Exact providers unconfirmed. Cloudflare sources: https://developers.cloudflare.com/workers/configuration/secrets/ ; https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ ; https://developers.cloudflare.com/durable-objects/best-practices/websockets/ . API keys should be Worker secrets; rate limiting is per-location/eventually consistent, so a strict shared spend cap needs centralized accounting. No AI implementation or paid model calls made.

- 2026-09-29 — Published https://spectre-remake.pages.dev on Cloudflare Pages. Production build passes (sim purity, TypeScript, Vite); opened production in Chrome and started single-player gameplay. Screenshot: `reference/verification/deployment/cloudflare-2026-09-29.png`. Repeat deploy with `npm run deploy`. Network multiplayer and mobile were not re-tested.


## 1. Local multiplayer (same machine)
- [x] Two players, split keyboard (arrows+Space/Alt-G vs WASD+F/Q), split-screen
- [x] Sim already supports it: a second human is just another `Command` source with a tank id —
      added a second `KeyboardInput` mapping + `state.player2: TankState | null` in `GameState`
- [x] Deathmatch scoring variant (kills win) alongside flag mode — "2P Duel" mode (first to
      `DUEL_KILL_TARGET` kills), separate from "2P Co-op" (shared flags vs AI)
- [x] Split-screen = two cameras + two scissored viewports in the renderer; radar per player

## 2. Web multiplayer (the real Spectre soul — up to 8 players over the network) — DONE (M1-M5)
- [x] Transport: WebRTC data channels via Trystero over public Nostr relays (no signaling server to
      run/deploy) — `net/trystero.ts`; `net/broadcast.ts` (BroadcastChannel) as the deterministic
      same-origin test path, `net/loopback.ts` for same-page multi-peer harnesses
- [x] Model: lockstep command exchange (`net/lockstep.ts`) — delayed-input, periodic hash exchange
      (`sim/hash.ts`) detects desync; fixed a real 3+-peer hash-comparison bug (M5) and a real
      rng-reseed bug (M5) found under multi-player testing, see net/CLAUDE.md
- [x] Lobby: host creates a room (room code + mode pick), joiners connect; "Net Play" menu wired up
      (`game/netscreens.ts`)
- [x] Remote players render as tanks with name tags (net play always follows the local player in a
      single viewport); join-in-progress isn't supported — every match starts fresh from
      `{level, mode, roster}`, no mid-match snapshot join
- [x] 3-8 players end-to-end (roster/spawns/HUD/AI already generalized in M1); disconnect
      robustness — grace period + host-authoritative drop + zombie-peer timeout
      (`DISCONNECT_GRACE_TICKS`/`ZOMBIE_TIMEOUT_MS`), "NAME left" toast, duel last-player-standing
      win, co-op continues solo
- [ ] Adaptive input delay (measure lobby RTT, pick 2-6 instead of the fixed
      `NET_INPUT_DELAY_TICKS`) — deferred, M5's optional stretch goal
- [ ] Worker-driven background pump for hidden/backgrounded tabs — deferred, M5's optional stretch
      goal (rAF throttling in a backgrounded tab is still the top real-world risk noted in the plan)

## 3. Deploy to a web server
- [x] `vite build` already produces a static `dist/` with `base: './'` — deployable anywhere
- [x] Host chosen: Cloudflare Pages (`spectre-remake`); multiplayer uses public relay signaling and requires no deployed server.
- [ ] Add favicon (kills the only console error), page title/meta, and a deploy script or CI step
- [ ] Playtest on a phone — decide whether touch controls are in scope

## 4. Future mechanics (the "more fun" iteration)
- [ ] **Smarter tanks that cooperate**: squad AI — flanking (approach from opposite bearings),
      suppressing fire while a hunter closes, guarding flags the player needs, retreating when
      outnumbered locally. Keep it in `ai.ts` as command producers; no sim structure change needed
- [ ] Faithful-mode fix first: finite enemy roster per level + "destroy all tanks" as an alternate
      win condition (the original had no mid-level respawn); keep infinite respawn behind
      `ENEMIES_RESPAWN` for arcade mode
- [ ] More weapon/pickup variety (Spectre Supreme/VR borrowed: seekers, mines, shield boosts)
- [ ] Game modes: time attack, survival waves, CTF vs AI team
- [ ] Juice: screen shake, hit flashes, better explosions, engine audio depth
- [ ] Optional: mobile/touch controls, gamepad support

## Known open items (carried from v1 verification)
- [ ] Bonus formula is a guess (500 start, −1/8 ticks) — original undocumented; tune by feel
- [ ] Score values (flags 100 / kills 200) are guesses — tune
- [ ] `?tune` live-slider panel for feel-tuning constants (planned in M10, not built)
