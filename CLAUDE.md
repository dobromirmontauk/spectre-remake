# Spectre (1991) Browser Replica

Faithful recreation of the Peninsula Gameworks Mac tank game. V1 (single-player) is complete.
Planned iterations: "more modern & more fun" pass, then networked multiplayer (the disabled
Net Play menu button). The architecture exists to serve that: **never break sim purity** (below).

## Commands

- `npm run dev` → http://localhost:5173 (Vite, hot reload)
- `npm run build` → tsc strict + vite build; must stay clean
- `.npmrc` pins `os=darwin` to override a global `os=linux` — **do not delete it**, the build breaks without it

## Architecture (one-way flow)

```
input/keyboard.ts → Command → sim/ (pure, 30 Hz fixed tick) → state + events
                                        ↓
                render/ (three.js mirror) · hud/ (DOM + radar canvas) · audio/sfx.ts · game/flow.ts (FSM)
```

- `game/app.ts` — loop: accumulator (clamp 5 ticks / 250ms), rAF render with interpolation.
  `frameEvents` array accumulates events across multi-tick frames — consume that, never `state.events` directly (it's overwritten each tick).
- `game/flow.ts` — FSM: Menu → TankSetup → LevelIntro ⇄ Playing → GameOver; pause + quit-confirm are orthogonal flags.
- `config/constants.ts` — EVERY tunable number lives here (or `levels.ts` for per-level ramps). No magic numbers in code.
- `config/palette.ts` — every color, per-theme. Themes rotate every 3 levels.

## Iron rules

1. `src/sim/` imports nothing from three.js or the DOM. Plain serializable data + free functions only.
2. All randomness through `state.rng` (seeded mulberry32); all time in ticks. Determinism is the future multiplayer contract.
3. Enemies and the player use the same `Command` type — a remote player later is just another command source.
4. Rendering/audio/HUD read state and events; they never mutate sim state.

## Verification (how we test)

Playwright against the dev server + `window.__game` debug API:
`getState()` (JSON snapshot), `pause/resume`, `stepTicks(n)`, `pressCommand(cmd, ticks)`, `fire()`,
`setLevel(n)`, `collectAllFlags()`, `setGod(b)`, `spawnEnemyAt(x,z,kind)`, `killAllEnemies()`,
`setLives(n)`, `cycleCamera()`, `restart()`, `gotoMenu()`, `startGame(loadout?, {mode, loadout2}?)`,
`setFilled(b)`, `setMuted(b)`, `hashState()` (deterministic state checksum, `sim/hash.ts` — the
desync-detection primitive for lockstep multiplayer).

Drive real keyboard keys for input-layer checks (the debug API bypasses `keyboard.ts`).
Visual ground truth: `reference/original/` (original-game screenshots + side-by-side). Past verification shots: `reference/verification/`.

## Fidelity spec (corrected from original screenshots — trust this over prose descriptions)

Black floor with sparse pixel dot-grid (NOT bright grid lines) · thin purple gradient horizon band ·
starfield sky · yellow flat-shaded obstacles · low wedge tanks (green player / red drones / orange hunters) ·
top-strip HUD on solid black (Lives / Damage bar / Ammo bar · Score / Level / Bonus in green LED digits · small H gauge) ·
bezel-less radar dot-cluster upper-right · "Filled" wireframe toggle · menu = chrome wordmark + beveled right-side buttons.

## Known deviations / open items

- Enemies respawn infinitely (~4s, arena edge). **The original had a finite roster** — destroying all
  tanks completed the level. Faithful change (finite roster + kill-all-wins, respawn behind a flag) is designed but not built.
- Bonus formula (500 start, −1 per 8 ticks, added on level clear) is a guess; original undocumented.
- Loadout presets are hand-tuned and don't sum to the Custom point budget (intentional).
- Score: flags +100, kills +200 (tunable guesses).
