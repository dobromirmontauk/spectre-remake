# TODO — Spectre → "Learn to Make Games" (kids' curriculum)

Turn the finished Spectre tank game into a learning tool for teenagers who've never made a game.
Two deliverables: **(A)** refactor the codebase into a visible two-tier **GAME layer over ENGINE layer**,
and **(B)** a **10-lesson curriculum** (1–2 hrs each) with a Socratic **"lesson mode"** where Claude
refuses to edit and only guides.

**Locked decisions:** single codebase, simple game layer over powerful engine layer (lessons 1–5 game,
6–10 engine) · lesson mode = **soft refusal** (persona declines to edit, no hook) · kids are **not set up
yet** (Lesson 1 covers installing Node/VS Code from zero).

Full plan with rationale: `~/.claude/plans/i-want-to-create-fluffy-seahorse.md`.

---

## Part A — Two-tier refactor

Target layout under `src/`:

```
src/
  game/                  ← THE GAME (simple) · lessons 1–5 · kids edit freely
    tune/constants.ts    gameplay numbers (movement, weapons, enemies, lives, scoring, arena, pickups)
    tune/levels.ts       per-level difficulty ramp
    colors.ts            themes + tank colors (was config/palette.ts)
    world.ts             data shapes GameState/Tank/Enemy/... (was sim/types.ts)
    commands.ts          Command intent (turn/thrust/fire/grenade)
    events.ts            SimEvent list
    rules/step.ts        step() + lifecycle/scoring/win-lose (was sim/simulation.ts)
    rules/movement.ts    tank physics
    rules/weapons.ts     projectiles + grenades
    rules/ai.ts          enemy state machine
    rules/levelgen.ts    arena generation
    look.ts              tank shape + entity→mesh choice + color mapping (content from meshes.ts)
    sound.ts             which sound per event + notes/pitches (content from sfx.ts)
    controls.ts          key → Command mapping (keymaps from keyboard.ts)
  engine/                ← THE ENGINE (powerful) · lessons 6–10 · "look, mostly don't touch"
    loop.ts              fixed-timestep accumulator + interpolation + wiring (was game/app.ts)
    flow.ts              game-state FSM
    input.ts             keyboard plumbing: held/edge sets + listeners (consumes game/controls.ts)
    render/              three.js mirror: renderer, flat-shading mesh machinery, arena, cameras, effects, retro
    audio.ts             WebAudio synthesis machinery (drives game/sound.ts)
    hud/                 hud, hudmp, radar, style.css
    net/                 multiplayer
    math/                deterministic primitives (pure LEAF): dmath, rng, collision, hash
    screens/             DOM overlays: screens, netscreens, highscores, debug (window.__game)
```

**Boundary (no cycles):** `engine/math` imports nothing · `game/` imports only `engine/math` (never
render/net/loop/DOM/three) · `engine/*` imports the game's contracts + `rules/step` + look/sound/controls.

**Three content/machinery splits:** meshes.ts → shapes to `game/look.ts`, flat-shading to
`engine/render/meshes.ts` · sfx.ts → sound choices to `game/sound.ts`, WebAudio engine to `engine/audio.ts`
· keyboard.ts → keymap to `game/controls.ts`, plumbing to `engine/input.ts`.

**Build/config:** repoint `scripts/check-sim-purity.mjs` to scan `src/game/rules/` + `game/{world,commands,
events}.ts` (and assert `game/` never imports three/DOM/engine-render/engine-net); add `@game/*` `@engine/*`
tsconfig+vite aliases; rewrite `src/game/CLAUDE.md`, `src/engine/CLAUDE.md`, and the root diagram.

**Execution order (build + run at each commit):**
- [ ] 1. `engine/math/` ← dmath, rng, collision, hash; fix imports; build.
- [ ] 2. `game/` ← contracts + rules + config; repoint purity script; build + run.
- [ ] 3. engine presentation/orchestration ← render, hud, net, loop, flow, screens; build + run + net smoke.
- [ ] 4. the three content/machinery splits (look/sound/controls); build + run.
- [ ] 5. path aliases + CLAUDE.md rewrites; final build + full playtest + 2-tab net check.

---

## Part B — 10-lesson curriculum

Worksheets in `lessons/lesson-NN.md`, each: **Goal → Concepts → Guided exploration (questions) → Hands-on
challenges (edit by hand, predict first) → Go Deeper → Ask-your-tutor prompts.** Challenges name the file
and *area*, not the exact line.

### GAME layer (1–5)
- [ ] **L1 — Get it running & first change.** From-zero setup (Node, VS Code, `npm install`, `npm run dev`);
      tour game/ vs engine/; edit lives/`MAX_SPEED` in `game/tune/constants.ts` and a color in `game/colors.ts`.
- [ ] **L2 — Controls.** `game/controls.ts` + `game/commands.ts`; remap/add a key. Input as intent.
- [ ] **L3 — Movement & feel.** `game/rules/movement.ts` + physics numbers; icy/snappy/heavy. Accel vs velocity; the 30 Hz tick.
- [ ] **L4 — Weapons.** `game/rules/weapons.ts` + numbers; trace a shot end-to-end. Entities, swept collision, events.
- [ ] **L5 — Enemies & levels.** `game/rules/ai.ts`, `tune/levels.ts`, `rules/levelgen.ts`, player roster;
      dumber/smarter/more enemies, arena size, add players. State machines, difficulty curves, procgen.

### ENGINE layer (6–10)
- [ ] **L6 — The game loop.** `engine/loop.ts`; fixed timestep, tick≠frame, interpolation.
- [ ] **L7 — Rendering & retro look.** `engine/render/` + `game/look.ts`; reshape the tank; restyle the world.
- [ ] **L8 — Sound & feedback.** `engine/audio.ts` + `game/sound.ts` + effects + `engine/hud/`; change/add a sound.
- [ ] **L9 — Multiplayer.** `engine/net/` (+ `math/hash`); lockstep; run a 2-tab `?net=bc` match; desync demo.
- [ ] **L10 — Determinism & capstone.** `engine/math/dmath.ts` (read); invent + build ONE new mechanic end-to-end.

---

## Part C — Lesson ("tutor") mode

- [ ] `.claude/commands/lesson.md` — `/lesson N` loads the teaching persona + reads `lessons/lesson-NN.md`.
- [ ] `.claude/commands/tutor.md` — `/tutor` for free-form help in the same persona.
- [ ] `TUTOR.md` — persona spec: **never edits code** (soft refusal, redirects to where/why) · **asks lots
      of questions** (predict-before-run) · **escalating hints**, not answers · pushes them to run & observe.
- [ ] `lessons/README.md` — overview + "type `/lesson 1` to start." Optional per-lesson git tags for reset/solutions.

---

## Verification

- Refactor: `npm run build` clean (tsc + purity on relocated tick logic + vite); `npm run dev` runs;
  `window.__game` drives it; `?net=bc` 2-tab match still agrees on `hashAtTick`. Move/rename only — the
  game must behave identically.
- Lessons: each challenge is doable editing only the named files, visible in `npm run dev`; dog-food L1 on a
  clean profile.
- Tutor: `/lesson 1` loads persona + worksheet and refuses to edit when asked, guiding instead.
