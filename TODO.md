# Roadmap

## 1. Local multiplayer (same machine)
- [ ] Two players, split keyboard (e.g. WASD+Q vs arrows+space), shared screen or split-screen
- [ ] Sim already supports it: a second human is just another `Command` source with a tank id —
      add a second `KeyboardInput` mapping + a second player tank in `GameState`
- [ ] Deathmatch scoring variant (kills win) alongside flag mode
- [ ] Split-screen = two cameras + two scissored viewports in the renderer; radar per player

## 2. Web multiplayer (the real Spectre soul — up to 8 players over the network)
- [ ] Transport: WebRTC data channels (peer-to-peer, low latency) with a tiny signaling server,
      or plain WebSocket relay as the simpler first cut
- [ ] Model: lockstep command exchange — the sim is already deterministic
      (seeded rng, fixed tick, plain-data state, same `Command` type for every tank);
      exchange per-tick commands, hash state periodically to detect desync
- [ ] Lobby: host creates a game (level seed + mode), others join; wire up the disabled
      "Net Play" menu button
- [ ] Remote players render as tanks with name tags; join-in-progress via state snapshot
      (GameState is JSON-serializable by design)

## 3. Deploy to a web server
- [ ] `vite build` already produces a static `dist/` with `base: './'` — deployable anywhere
- [ ] Pick host: GitHub Pages / Netlify / Cloudflare Pages (static is enough until multiplayer
      needs a signaling server; Cloudflare Workers or a tiny Node process can host that later)
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
