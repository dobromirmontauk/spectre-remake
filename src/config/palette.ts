// Per-theme hex colors. Themes rotate by level (see levels.ts).
//
// The originals render on a black sky/black floor. Color lives almost
// entirely in: the horizon glow band (bright at the ground, fading to black
// overhead), the obstacle/windmill yellow, and a couple of accent colors.
// Hues below were sampled from reference screenshots (see scratchpad).

export interface Theme {
  name: string;
  sky: number;
  ground: number;
  dotColor: number; // floor dot-grid points
  horizonBase: number; // top of horizon band — near-black, blends into the sky
  horizonPeak: number; // bottom of horizon band — brightest, sits at ground level
  wallTop: number;
  wallSide: number;
  wallFront: number;
  windmillTop: number;
  windmillSide: number;
  windmillBlade: number;
  flag: number;
  ammoPickup: number;
  shieldPickup: number;
}

export const THEMES: Theme[] = [
  {
    // Sampled directly from spectre1.png's horizon band: a near-black
    // #0f000f at the top fading down to a bright #b900b9 magenta at the base.
    name: 'classic',
    sky: 0x000000,
    ground: 0x000000,
    dotColor: 0xffffff,
    horizonBase: 0x0f000f,
    horizonPeak: 0xb900b9,
    wallTop: 0xdfdf00,
    wallSide: 0x707000,
    wallFront: 0xb4b400,
    windmillTop: 0xffee66,
    windmillSide: 0x998800,
    windmillBlade: 0xfff4b0,
    flag: 0xffee55,
    ammoPickup: 0xffff00,
    shieldPickup: 0x00ccff,
  },
  {
    // Alt theme: warm orange/red horizon (judgment call — no clean sample of
    // this theme was available, tuned to sit in the same family as the
    // pink/orange banding visible in SpectreScreenshot.jpg).
    name: 'dunes',
    sky: 0x000000,
    ground: 0x000000,
    dotColor: 0xffe0c0,
    horizonBase: 0x140600,
    horizonPeak: 0xff5500,
    wallTop: 0xdfdf00,
    wallSide: 0x707000,
    wallFront: 0xb4b400,
    windmillTop: 0xffee66,
    windmillSide: 0x998800,
    windmillBlade: 0xfff4b0,
    flag: 0x55eeff,
    ammoPickup: 0xffff00,
    shieldPickup: 0x00ccff,
  },
  {
    // Alt theme: cool blue/violet horizon (judgment call, same reasoning as
    // 'dunes' — kept distinct in hue from both other themes).
    name: 'eye',
    sky: 0x000000,
    ground: 0x000000,
    dotColor: 0xe0e0ff,
    horizonBase: 0x05001a,
    horizonPeak: 0x6a1aff,
    wallTop: 0xdfdf00,
    wallSide: 0x707000,
    wallFront: 0xb4b400,
    windmillTop: 0xffee66,
    windmillSide: 0x998800,
    windmillBlade: 0xfff4b0,
    flag: 0xffee55,
    ammoPickup: 0xffff00,
    shieldPickup: 0x00ccff,
  },
];

export function themeForLevel(level: number): Theme {
  const idx = Math.floor((level - 1) / 3) % THEMES.length;
  return THEMES[idx]!;
}

// Tank hull colors — fixed regardless of level theme (the original always
// renders the player green, standard enemies red, hunters orange).
export interface TankHullColors {
  top: number;
  side: number;
  front: number;
}

export const PLAYER_TANK_COLORS: TankHullColors = { top: 0x88ff88, side: 0x226622, front: 0x44cc44 };
// Player 2 (2P co-op/duel only): blue/cyan family, kept distinct from both
// the green player-1 hull and the red/orange enemy hulls.
export const PLAYER2_TANK_COLORS: TankHullColors = { top: 0x7fd4ff, side: 0x0e4a66, front: 0x2ab0e6 };
export const DRONE_TANK_COLORS: TankHullColors = { top: 0xff6666, side: 0x881111, front: 0xdd2222 };
export const HUNTER_TANK_COLORS: TankHullColors = { top: 0xffb347, side: 0x8a4500, front: 0xff8c1a };
