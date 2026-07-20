# sim/ — deterministic core

**Contract: pure, plain-data, deterministic.** No three.js/DOM imports. No `Math.random()`,
`Date.now()`, or wall-clock anywhere — randomness via `state.rng` (mulberry32), time via `state.tick`.
`GameState` must stay JSON-serializable (this is the future multiplayer wire contract; lockstep
replays `step(state, commandsByTankId)`).

**No native trig/hypot** — `Math.sin/cos/atan2/hypot` are not bit-identical across JS engines (only
"implementation-approximated", per spec), which desyncs a future lockstep match tick by tick. Use
`dmath.ts`'s `dsin/dcos/datan2/dlen` instead — built only from `+ - * /`, comparisons, and
`Math.sqrt/abs/floor` (all IEEE-754-exact), so they're bit-identical everywhere. `scripts/check-sim-purity.mjs`
(wired into `npm run build`) fails the build if a forbidden `Math.*` call (or `Date./performance./.sort(/new Set(/new Map(`)
shows up anywhere in `sim/` outside `dmath.ts` itself. `players[]` slots and enemy/projectile/grenade ids
must also stay reconstructible from `(state, commands)` alone — no module-global counters (`ai.ts` learned
this the hard way; see its `createEnemy` doc comment) — because `hash.ts`'s `hashState()` and any future
network replay both depend on it.

**Players are N, not 2**: `GameState.players: PlayerState[]`, slot order == array order (solo = 1 entry,
local 2P = 2, net play M2+ up to 8). Tank ids stay the strings `'player'`/`'player2'` for slots 0/1
(events, kill credit, and Playwright expectations all key off those two); slot ≥2 uses `'player3'..'player8'`.

**`removePlayer(state, slot, events)` (M5, `simulation.ts`) is part of the deterministic replay**,
exactly like a `Command` — it's driven by a `drop` network message every peer applies at the
identical tick (`step()`'s `drops` parameter), never by local disconnect detection. The player
stays IN `state.players` (slot/array index and `PLAYER_TANK_COLOR_SLOTS` mapping must stay stable
for the HUD/duel scoreboard) but is flagged `removed: true`: dead, out of lives, shield zeroed,
and skipped by `resetPlayerForLevel` forever after so a mid-level co-op disconnect isn't silently
revived on the next level clear. Duel: dropping to the last connected player ends the match with
them as the winner, same `GameOver` shape as reaching `DUEL_KILL_TARGET`. See net/CLAUDE.md's
"Disconnect robustness" for the full grace/zombie/drop protocol that decides *when* to call it.

**A fresh match must reseed `state.rng`, not just reset tick/score/ids** — `resetGameWithRoster`
learned this the hard way (M5): leaving `rng` un-reseeded is invisible right up until the first
`state.rng.next()` call produces a different draw on two peers with different leftover state, and
`hash.ts` hashes `rng.state` directly. See net/CLAUDE.md for the full story.

## Tick order (`simulation.ts` step)

1. Build commands (player command passed in; `ai.ts` produces enemy commands — same `Command` type)
2. `movement.ts` — heading turn + thrust/coast per tank
3. Per-tank static resolution — obstacle circle-vs-AABB push-out, arena containment
4. `resolveTankVsTankCollisions` — pairwise circle push-out (player-enemy + enemy-enemy)
5. Final static pass — re-clamp after pair push-out. **Arena clamp is the absolute last spatial op**;
   no tank may end a tick outside the arena or inside an obstacle (regression: boundary-ram ejection bug)
6. `weapons.ts` — projectile/grenade integration, swept collision, damage, kills, respawn timers
7. Trigger overlaps — flags, pickups
8. Lifecycle — lives, invulnerability ticks, level complete, game over

## Conventions

- **Heading**: 0 = facing +z; positive turn rotates nose toward +x, which is **screen-left** in
  chase/first-person view (camera right = forward × up = −x). `forward = (sin h, 0, cos h)`.
  `keyboard.ts` maps ArrowLeft → turn=+1 accordingly — don't "fix" the sign.
- **Speed**: loadout stat keeps Spectre's authentic 0–18 scale; world speed = stat × `LOADOUT_SPEED_TO_WORLD`.
  All linear speeds/accels (enemy, projectile, friction) are scaled together — rescale in lockstep or balance breaks.
- **Projectiles**: swept segment tests per tick (fast, would tunnel otherwise). Segment start-inside-circle/AABB
  counts as a hit at t=0 (point-blank bug regression); shooter excluded by owner id, not spatially.
  A shot's collision segment **spawns at the owner's CENTER, not its nose** (`fireProjectile`): the nose
  offset (`TANK_RADIUS + 0.5` = 2.1) exceeds the tank hit radius (`TANK_RADIUS + PROJECTILE_RADIUS` = 1.9),
  so at point-blank — where tank-vs-tank push-out hasn't separated the overlapping pair yet this tick — a
  nose-spawned shot starts past the target's far edge and its forward-only sweep misses ("bullets pass
  through at point-blank"). Center-spawn guarantees an overlapping target is swept; the muzzle flash still
  reads the nose position from the `ShotFired` event.
- **Enemy friendly fire** (`state.enemyFriendlyFire`, default `ENEMY_FRIENDLY_FIRE_DEFAULT` = true): when
  off, `updateProjectiles` skips enemy→enemy hits (same guard shape as co-op's player→player skip). It's a
  match-constant reset to the default by `createInitialState` AND `resetGameWithRoster`, so every net peer
  agrees without protocol changes (a local toggle can't leak into a later net match and desync it) — hence
  the `__game.setEnemyFriendlyFire` debug setter throws in net play.
- **Grenades in duel** (M5, `weapons.ts` `explodeGrenade`/`damageDuelPlayers`): the blast damages
  non-owner alive PLAYERS too, gated strictly on `state.mode === 'duel'` — co-op/solo grenades
  still can't hurt players at all (same no-friendly-fire rule as cannon shots). Duel also grants
  grenades from the start (`GRENADES_IN_DUEL`) since duel has no levels, so `levelConfig(1)`'s
  `grenadesUnlocked` (level ≥ 10) would otherwise never open.
- **Events**: `state.events` is per-tick scratch, overwritten each tick. Emit events for anything
  render/audio/HUD must react to; never call out of the sim.
- **Collision is 2D** (y is cosmetic): tanks/flags/pickups = circles, walls = AABBs, arena = 4 half-planes.
  Windmill collider = pylon circle only; blades are visual. Blade angle lives in sim state (may collide someday).
- AI FSM: PURSUE (turn-rate-limited → natural orbiting) / FIRE (aim cone + range + jittered cooldown) /
  UNSTICK (reverse-turn when wedged). Hunters add target-leading. No pathfinding — faithful to the original.
