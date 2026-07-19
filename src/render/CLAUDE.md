# render/ — three.js mirror of sim state

**Read-only consumer.** Renders from state snapshots + `frameEvents`; never mutates sim state.
Sizes/counts in `config/constants.ts`, colors in `config/palette.ts` — no literals here.

## Interpolation

Entities carry `prevPosition`/`prevHeading` (copied at tick start). Renderer lerps by accumulator
alpha; heading lerps along the **shortest angular path**. On teleports (respawn, level change)
reset prev = current or the entity visibly slides across the arena for one frame.

## The retro look (hard-won, don't regress)

- **Flat shading**: baked per-face vertex colors (2–3 shades: top/side/front) on unlit
  `MeshBasicMaterial({vertexColors})` + `EdgesGeometry` black outlines. Single-color unlit meshes
  read as flat blobs — always bake face shades.
- **Wireframe toggle**: all vertex-color materials register in the tracked-materials registry in
  `meshes.ts`; `setFilledMode(bool)` flips `.wireframe` live. New materials must register too.
- **Dot-grid floor**: `THREE.Points`, `sizeAttenuation: false`, ~2.5px — uniform tiny pixels at any
  distance (attenuated points looked like chunky dashes). Same for starfield (2px).
- **Horizon band**: 4 gradient walls just outside the arena, `HORIZON_BAND_HEIGHT` (12) tall,
  vertex-gradient bright at y=0 → near-black at top, BackSide. Height matters: at 26 it towered
  over the scene and hid behind the HUD strip.
- **Tank wedge**: base pentagon + inset roof; taper lives almost entirely in the nose
  (`TANK_ROOF_INSET_NOSE` 0.8 vs `_SIDE` 0.1) — even side insets read as a "gem", not a tank.
- **Chase camera**: aims at `tankPos + forward × CHASE_LOOKAHEAD` (28), NOT at the tank — pitch
  ~13° keeps the horizon in frame below the black HUD strip and the tank in the lower third.
- **Windmills**: blades in the VERTICAL plane (fan-style, horizontal spin axis), angle from sim state.
- Effects (`effects.ts`) are event-driven cosmetics only — muzzle/impact/explosions/grenade arc.
- `retro.ts` pixelation (`PIXELATE` flag) is default-OFF: at 2× it muddied edges and silhouettes.
