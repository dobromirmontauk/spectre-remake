// All tunable numbers for the sim and its presentation live here.
// Values are best-effort approximations of the 1991 original; tune by feel.

export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;

export const ARENA_HALF_SIZE = 100; // arena spans [-100, 100] on x and z (~200 units)

// --- Movement (Balanced preset baked in; presets screen comes later) ---
export const TURN_RATE = Math.PI * 0.9; // radians/sec at full turn input
export const THRUST_ACCEL = 40; // units/sec^2 while thrust held
export const REVERSE_ACCEL = 26; // units/sec^2 while reverse held
export const COAST_FRICTION = 18; // units/sec^2 deceleration with no thrust input
export const MAX_SPEED = 18; // units/sec forward
export const MAX_REVERSE_SPEED = 14; // units/sec reverse

// --- Collision ---
export const TANK_RADIUS = 1.6;
export const WALL_STOPS_DEAD = true; // faithful "clunk": hitting a wall zeroes speed
export const PLAYER_SAFE_RADIUS = 25; // no obstacles spawn within this of player start

// --- Level generation ---
export const LEVELGEN_SEED_BASE = 0x5ec7e123;
export const ENEMY_SEED_SALT = 0xa5a5a5a5; // keeps enemy-roster rng independent of obstacle/flag rng
export const WALL_COUNT = 8;
export const WINDMILL_COUNT = 4;
export const WALL_MIN_SIZE = 4;
export const WALL_MAX_SIZE = 10;
export const OBSTACLE_MIN_SEPARATION = 14;
export const EDGE_MARGIN = 8;
export const WINDMILL_PYLON_RADIUS = 1.2;
export const WINDMILL_BLADE_LENGTH = 6;
export const WINDMILL_SPIN_RATE = Math.PI * 0.5; // radians/sec
export const OBSTACLE_WALL_HEIGHT = 4;

// --- Chase camera ---
// Raised and pulled back so the tank reads small and looked-down-upon (~25
// degree depression), matching the reference's third-person framing, instead
// of a low close-in view that fills the screen with the tank's rear face.
export const CHASE_DISTANCE = 22;
export const CHASE_HEIGHT = 12;
// Look-at point is projected ahead of the tank (not on it) so the shallower
// resulting pitch (~13 degrees) drops the horizon into the upper third of the
// viewport instead of hiding it behind the opaque HUD strip at the very top.
export const CHASE_LOOKAHEAD = 28;
export const CHASE_SMOOTHING = 0.0001; // per-second decay factor for exponential smoothing

// --- Flags & pickups ---
export const FLAGS_PER_LEVEL = 10;
export const FLAG_COLLECT_RADIUS = 2.5;
export const AMMO_PICKUP_COUNT = 4;
export const SHIELD_PICKUP_COUNT = 4;
export const PICKUP_COLLECT_RADIUS = 2.2;
export const AMMO_PICKUP_AMOUNT = 20;
export const SHIELD_PICKUP_AMOUNT = 25;

// --- Player defaults (Balanced preset) ---
export const PLAYER_START_SHIELD = 100;
export const PLAYER_MAX_SHIELD = 100;
export const PLAYER_START_AMMO = 80;
export const PLAYER_MAX_AMMO = 127;
export const REFILL_ON_LEVEL_START = true;

// --- Tank setup / loadout (M9b) ---
// Speed uses the same 0-18 scale as MAX_SPEED; ammo is capped at
// PLAYER_MAX_AMMO (127, the original's documented ammo cap).
// Loadout speed stat keeps Spectre's authentic 0-18 scale; world speed is
// stat * LOADOUT_SPEED_TO_WORLD (arena is 200 units, tank ~4.5 long).
export const LOADOUT_SPEED_TO_WORLD = 2;
export const LOADOUT_SPEED_MIN = 4;
export const LOADOUT_SPEED_MAX = MAX_SPEED; // 18
export const LOADOUT_SPEED_REFERENCE = MAX_SPEED; // movement-feel scaling reference, see deriveMovementParams
export const LOADOUT_SHIELDS_MIN = 50;
export const LOADOUT_SHIELDS_MAX = 150;
export const LOADOUT_AMMO_MIN = 40;
export const LOADOUT_AMMO_MAX = PLAYER_MAX_AMMO; // 127

// Turn-rate/acceleration scale range applied on top of the base constants as
// a function of loadout speed fraction (0..1) — see deriveMovementParams.
export const LOADOUT_TURN_RATE_SCALE_MIN = 0.85;
export const LOADOUT_TURN_RATE_SCALE_RANGE = 0.3;
export const LOADOUT_THRUST_SCALE_MIN = 0.6;
export const LOADOUT_THRUST_SCALE_RANGE = 0.8;

export interface LoadoutPreset {
  id: 'balanced' | 'speedy' | 'strong';
  name: string;
  speed: number;
  shields: number;
  ammo: number;
}

// Trade-off presets (tunables — judgment call, unpublished in the original).
export const LOADOUT_PRESETS: LoadoutPreset[] = [
  { id: 'balanced', name: 'Balanced', speed: 9, shields: 100, ammo: 80 },
  { id: 'speedy', name: 'Speedy', speed: 14, shields: 60, ammo: 60 },
  { id: 'strong', name: 'Strong', speed: 5, shields: 140, ammo: 100 },
];

export const DEFAULT_LOADOUT = LOADOUT_PRESETS[0]!; // Balanced

// Shared point budget for the Custom loadout's three sliders. Cost per point
// is uniform across stats (simplest to explain on a tank-setup screen);
// sliders are clamped to their own min/max in addition to the shared budget.
export const POINT_BUDGET = 100;
export const CUSTOM_SPEED_COST_PER_POINT = 1; // 1 budget point per unit of top speed
export const CUSTOM_SHIELDS_COST_PER_POINT = 0.5; // shields are cheap per-point (wide 50-150 range)
export const CUSTOM_AMMO_COST_PER_POINT = 0.5; // ammo likewise cheap per-point (wide 40-127 range)

// --- Loop timing ---
export const MAX_FRAME_DT_MS = 250; // clamp huge tab-switch frame deltas
export const MAX_ACCUMULATED_TICKS = 5; // clamp catch-up ticks per frame

// --- Level intro overlay ---
export const LEVEL_INTRO_DURATION_TICKS = SIM_HZ * 1.5; // ~1.5s "LEVEL N" card

// --- Floor dot-grid (replaces solid grid lines) ---
export const DOT_GRID_SPACING = 8; // world units between dot rows/columns
export const DOT_GRID_SIZE = 2.5; // screen-space px, sizeAttenuation off — uniform tiny dots at any distance

// --- Horizon band (gradient ring around the arena boundary) ---
// World-unit height is tuned against the low chase camera, not screen
// fraction directly: too tall and most of the visible slice samples only the
// bright end of the gradient (the fade-to-black happens off-screen above).
export const HORIZON_BAND_HEIGHT = 12; // world units tall; bright at y=0, fades to black at top

// --- Starfield (static, above the horizon) ---
export const STAR_COUNT = 260;
export const STAR_DOME_RADIUS = 400;
export const STAR_POINT_SIZE = 2; // screen-space px, sizeAttenuation off

// --- Tank wedge hull geometry ---
// A wide, short slab with the taper concentrated at the nose (roof pulled far
// back toward the tail there) and the side/rear roof edges nearly flush with
// the base — reads as a flat wedge with a sloped nose, not a faceted gem.
export const TANK_LENGTH = 4.5;
export const TANK_WIDTH = 2.2;
export const TANK_HEIGHT = 0.35;
export const TANK_ROOF_INSET_NOSE = 0.8; // roof nose pulled toward center by this fraction
export const TANK_ROOF_INSET_SIDE = 0.1; // roof wing/tail corners pulled toward center by this fraction

// --- Wireframe/filled toggle (the original's "Filled" menu button) ---
export const RENDER_FILLED = true;

// --- Retro pixelation mode (M10) ---
// Default OFF: at ~2x reduction the sparse floor dot-grid loses too many
// dots to sub-pixel blending/aliasing and reads as muddy rather than
// charmingly chunky (judgment call per the plan's own escape hatch — see
// render/retro.ts). Flip to true to try it; PIXELATE_SCALE tunes the amount.
export const PIXELATE = false;
export const PIXELATE_SCALE = 2; // drawing-buffer resolution divisor

// --- Weapons: cannon ---
export const PLAYER_FIRE_COOLDOWN_TICKS = 8; // ~0.27s between shots
export const AMMO_PER_SHOT = 1;
export const PROJECTILE_SPEED = 120; // units/sec — fast relative to MAX_SPEED to read as instant
export const PROJECTILE_RADIUS = 0.3;
export const PROJECTILE_RANGE = 300; // > arena diagonal (~283): shots fly until they hit something
export const PROJECTILE_MAX_TICKS = Math.ceil(PROJECTILE_RANGE / PROJECTILE_SPEED / SIM_DT);
export const PLAYER_DAMAGE_PER_SHOT = 12; // player maxShield is a 0-100 scale
export const ENEMY_DAMAGE_PER_SHOT = 1; // enemy shield is a small hit-point count
// Whether an enemy's cannon shot damages OTHER enemies it flies into (default
// on — an enemy caught in a crossfire takes real damage, which the original's
// dumb drones did to each other too). Toggle live via __game.setEnemyFriendlyFire.
export const ENEMY_FRIENDLY_FIRE_DEFAULT = true;

// --- Weapons: grenades (unlocked level 10+) ---
export const GRENADE_AMMO_COST = 10;
export const GRENADE_COOLDOWN_TICKS = 45; // ~1.5s throttle even if key held
export const GRENADE_SPEED = 55; // slower lob than cannon shots
export const GRENADE_FUSE_TICKS = 60; // ~2s flight before auto-detonation
export const GRENADE_BLAST_RADIUS = 18;
export const GRENADE_DAMAGE = 5; // area damage applied to every enemy in radius
// --- Weapons: duel grenade fix (M5, plan Design §1 deferred item) ---
// Duel has no levels (levelConfig(1).grenadesUnlocked is always false), so
// without this a duel match would never unlock grenades at all — grant them
// from the start instead of gating on level (see sim/simulation.ts
// handlePlayerWeapons). A deliberate duel-only gameplay change, not a
// regression: grenades were dead code in duel before this milestone.
export const GRENADES_IN_DUEL = true;
// Duel-only splash damage against player shields when a grenade explodes
// near a non-owner alive player (see sim/weapons.ts explodeGrenade). Co-op/
// solo grenades still can't hurt players at all (the no-friendly-fire guard
// stays in place, same as cannon shots). Tuned notably harder than one
// cannon shot (PLAYER_DAMAGE_PER_SHOT=12) so the area weapon and its ammo
// cost/cooldown are worth it in a 1v1/FFA fight.
export const GRENADE_DAMAGE_PLAYER = 35;

// --- Enemy tanks: base movement (before per-level ramp, see levels.ts) ---
export const ENEMY_TURN_RATE = Math.PI * 0.6; // slower than the player's so it can be out-turned
export const ENEMY_THRUST_ACCEL = 32;
export const ENEMY_REVERSE_ACCEL = 20;
export const ENEMY_COAST_FRICTION = 16;
export const ENEMY_BASE_MAX_SPEED = 20;
export const ENEMY_MAX_REVERSE_SPEED = 12;
export const HUNTER_BASE_MAX_SPEED = 28; // orange hunters (level 6+): faster
export const ENEMY_TANK_RADIUS = TANK_RADIUS;

// --- Enemy AI: aim/fire ---
export const ENEMY_AIM_CONE_RAD = (8 * Math.PI) / 180; // ~8 degrees, per plan
export const ENEMY_FIRE_RANGE = 60;
// Fire-cooldown ramp: level 1 is a deliberately forgiving ~3s between shots
// per enemy (the original's early levels were gentle); ramps down to a snappy
// ~0.67s floor by ENEMY_FIRE_COOLDOWN_RAMP_LEVELS, see levels.ts.
export const ENEMY_FIRE_COOLDOWN_LEVEL1_TICKS = 90;
export const ENEMY_FIRE_COOLDOWN_FLOOR_TICKS = 20;
export const ENEMY_FIRE_COOLDOWN_RAMP_LEVELS = 20;
export const ENEMY_FIRE_COOLDOWN_JITTER_TICKS = 15; // seeded random extra added on each reset
export const HUNTER_LEAD_TIME_SCALE = 1; // multiplier on distance/PROJECTILE_SPEED for target-leading aim

// --- Enemy AI: unstick ---
export const STUCK_DISPLACEMENT_EPSILON = 0.05; // world units/tick below which a thrusting tank is "not moving"
export const STUCK_TICKS_THRESHOLD = 30; // ~1s wedged before UNSTICK triggers
export const UNSTICK_DURATION_TICKS = 21; // ~0.7s reverse-and-turn maneuver

// --- Enemy population / respawn ---
export const ENEMY_RESPAWN_TICKS = 120; // ~4s after death
export const ENEMY_MIN_SPAWN_DIST_FROM_PLAYER = 40;
export const HUNTER_SHIELD_BONUS = 2; // hunters are tougher than drones at the same level
// Enemies have unlimited ammo; a plain large finite number instead of
// Infinity so GameState (and enemy.ammo/maxAmmo) stays JSON round-trip safe
// — JSON.stringify(Infinity) produces `null`, which would silently corrupt
// state on any serialize/deserialize (the sim/hash.ts walk, and later the
// network wire format, both depend on state staying exactly reconstructible
// from its JSON form).
export const ENEMY_AMMO = 999999;

// --- Local multiplayer (2P co-op / duel) / N-player prep (net play, M2-M5) ---
export const MAX_PLAYERS = 8;
export const DUEL_KILL_TARGET = 5; // first player to this many kills wins the duel
export const DUEL_RESPAWN_TICKS = SIM_HZ * 2; // ~2s dead before respawning
export const DUEL_RESPAWN_INVULN_TICKS = SIM_HZ * 1.5; // ~1.5s brief invuln after a duel respawn
export const DUEL_SPAWN_EDGE_MARGIN = 20; // duel spawns sit this far in from the arena edge, on opposite sides
export const COOP_SPAWN_OFFSET = 5; // slot 1's co-op spawn offset east of center (unchanged legacy value)
export const SPLIT_SCREEN_DIVIDER_PX = 2; // width of the vertical divider line between 2P viewports

export interface SpawnPoint {
  x: number;
  z: number;
  heading: number;
}

// Fixed per-slot spawn points, index = player slot (0-7). Slots 0/1 reproduce
// today's coop/duel spawns exactly (byte-identical regression requirement);
// slots 2-7 aren't reachable by any local flow today (max 2 local players) —
// they exist so the sim already has a defined, deterministic answer once net
// play (M2-M5) allows 3-8 players. Exact double literals, computed OFFLINE
// (see the node one-liner in the M1 commit that generated them) rather than
// with runtime trig, per the sim purity rule (no Math.sin/cos at spawn time).
//
// Slots are placed via a bit-reversal ordering around the arena (0, 4, 2, 6,
// 1, 5, 3, 7 in angular order) so that adding players one at a time always
// keeps them maximally spread out, rather than clustering the 3rd/4th/5th
// player into one arc while the far side of the arena sits empty.
export const DUEL_SPAWN_POINTS: SpawnPoint[] = [
  { x: 0, z: -80, heading: 0 }, // slot 0 — unchanged: south edge, facing north
  { x: 0, z: 80, heading: Math.PI }, // slot 1 — unchanged: north edge, facing south
  { x: -80, z: 0, heading: 1.5707963267948966 },
  { x: 80, z: 0, heading: -1.5707963267948966 },
  { x: -56.5685424949238, z: -56.56854249492382, heading: 0.7853981633974483 },
  { x: 56.56854249492379, z: 56.56854249492382, heading: -2.356194490192344 },
  { x: -56.56854249492382, z: 56.56854249492379, heading: 2.356194490192344 },
  { x: 56.56854249492387, z: -56.56854249492373, heading: -0.7853981633974492 },
];

// Co-op has no "facing an opponent" requirement, so extra slots just ring the
// center at a wider radius than the legacy slot-1 offset (facing heading 0,
// same as everyone else — cooperative, not adversarial). Same bit-reversal
// angular placement as the duel ring, computed offline.
export const COOP_SPAWN_POINTS: SpawnPoint[] = [
  { x: 0, z: 0, heading: 0 }, // slot 0 — unchanged: arena center
  { x: COOP_SPAWN_OFFSET, z: 0, heading: 0 }, // slot 1 — unchanged: COOP_SPAWN_OFFSET east of center
  { x: -15, z: 0, heading: 0 },
  { x: 15, z: 0, heading: 0 },
  { x: -10.606601717798211, z: -10.606601717798215, heading: 0 },
  { x: 10.60660171779821, z: 10.606601717798215, heading: 0 },
  { x: -10.606601717798215, z: 10.60660171779821, heading: 0 },
  { x: 10.606601717798226, z: -10.6066017177982, heading: 0 },
];

// --- Networking (M2+): transport/lobby tunables ---
export const PROTOCOL_VERSION = 1;
// How long a joiner waits for the host's `lobby` reply after sending
// `hello` before concluding no host is listening on that room code (see
// net/lobby.ts join()). Not a transport-level timeout — BroadcastChannel/
// Loopback joins never fail at that layer (no network round trip).
export const NET_ROOM_NOT_FOUND_TIMEOUT_MS = 5000;
export const NET_NAME_STORAGE_KEY = 'spectre.netplay.name.v1';

// --- Networking (M3): lockstep tunables ---
// Delayed-input window: local commands sampled "now" are scheduled for
// tick T+D rather than T, giving every peer's `input` packet time to arrive
// before the tick that consumes it. 3 ticks @ 30Hz = 100ms — generous for
// same-origin BroadcastChannel, and carried in `start` (config/protocol.ts
// StartMessage) so a future adaptive-delay scheme (M5+) can raise it per-match
// without a protocol change.
export const NET_INPUT_DELAY_TICKS = 3;
// Each `input` packet resends this many trailing ticks (belt-and-suspenders
// over a reliable-ordered DataChannel/BroadcastChannel — see net/lockstep.ts).
export const INPUT_REDUNDANCY = 3;
// Cadence (in ticks) for the desync-detection hash exchange (sim/hash.ts's
// hashState()) — every peer hashes its own state at tick multiples of this
// and compares against peers' `hash` messages for the same tick.
export const HASH_INTERVAL_TICKS = 60;
// How many of the local peer's own hashes (at HASH_INTERVAL_TICKS boundaries)
// stay available for __game.net.hashAtTick() / late-arriving peer comparison.
export const NET_HASH_RING_SIZE = 10;
// Wall-clock delay before the "Waiting for NAME…" stall overlay appears —
// avoids flashing it for a single skipped frame under normal jitter.
export const STALL_OVERLAY_MS = 300;

// --- Networking (M5): disconnect robustness ---
// How long (in ticks — converted to wall-clock ms in net/lockstep.ts, since
// this check must keep running even while the match is fully stalled and no
// ticks are advancing) the host waits after detecting a peer's transport-
// level leave before broadcasting the authoritative `drop`. Every peer fills
// that slot's commands with NEUTRAL_COMMAND for the whole window instead of
// blocking canStep() on a departed peer's missing input (see
// net/lockstep.ts) — ~5s: long enough not to be trigger-happy, short enough
// that "NAME left" doesn't feel like it takes forever.
export const DISCONNECT_GRACE_TICKS = 150;
// Host-side only: if a (non-self) roster slot hasn't sent an `input` packet
// in this many wall-clock ms, the host treats it as gone and broadcasts a
// `drop` immediately — no additional grace on top, since 10s of silence
// already exceeds DISCONNECT_GRACE_TICKS several times over. Catches a peer
// whose transport connection is still technically alive but has stopped
// producing input (see net/lockstep.ts, __game.net.debugStallInject).
export const ZOMBIE_TIMEOUT_MS = 10000;
// "NAME left the game" transient toast (game/app.ts), driven by the
// PlayerLeft sim event — purely cosmetic display duration, not part of the
// wire protocol.
export const PLAYER_LEFT_TOAST_MS = 3000;

// --- Networking (M4): TrysteroTransport (net/trystero.ts) ---
// Trystero room namespace — rooms are scoped to (appId, roomCode), so this
// just needs to be unique enough not to collide with unrelated apps on the
// same public relays/trackers.
export const TRYSTERO_APP_ID = 'spectre-remake';
// Pinned public Nostr relay set (a handful of the well-known ones out of
// trystero/nostr's much larger built-in default list) — carries only the
// WebRTC signaling handshake, never gameplay traffic. A constant array so
// it's easy to extend/replace if one goes down; passed as
// `relayConfig.urls` so joinRoom() doesn't fall back to trystero's full
// default list (some of which are unmaintained/flaky).
export const TRYSTERO_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.mostr.pub',
  'wss://nostr.data.haus',
  'wss://nostr-01.yakihonne.com',
];
// How long TrysteroTransport.join() waits for at least one pinned relay's
// WebSocket to open before rejecting as "relay unreachable" (net/lobby.ts's
// LobbyErrorReason). Distinct from NET_ROOM_NOT_FOUND_TIMEOUT_MS above,
// which fires only once the relay IS reachable but no host answers.
export const NET_JOIN_TIMEOUT_MS = 10000;

// --- Lives / scoring / bonus ---
export const PLAYER_LIVES_START = 3;
export const PLAYER_RESPAWN_INVULN_TICKS = 60; // ~2s after respawning at arena center
export const SCORE_FLAG = 100;
export const SCORE_ENEMY_KILL = 200;
export const BONUS_START = 500; // per-level countdown value, added to score on LevelComplete (tunable — judgment call)
// Decays 1 point every N ticks (not every tick) so a normal ~60-90s level
// clear still retains a meaningful chunk of bonus: at this rate it takes
// ~133s (4000 ticks) to reach 0, so a 75s clear keeps ~44% of it.
export const BONUS_DECAY_INTERVAL_TICKS = 8;
