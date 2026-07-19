import * as THREE from 'three';
import type { Theme } from '../config/palette.ts';
import {
  ARENA_HALF_SIZE,
  DOT_GRID_SPACING,
  DOT_GRID_SIZE,
  HORIZON_BAND_HEIGHT,
  STAR_COUNT,
  STAR_DOME_RADIUS,
  STAR_POINT_SIZE,
} from '../config/constants.ts';

export interface ArenaControls {
  setTheme(theme: Theme): void;
}

type WallSpan = [x: number, z: number, sizeX: number, sizeZ: number];

const BOUNDARY_THICKNESS = 2;
const BOUNDARY_SPANS: WallSpan[] = [
  [0, ARENA_HALF_SIZE + BOUNDARY_THICKNESS / 2, ARENA_HALF_SIZE * 2 + BOUNDARY_THICKNESS * 2, BOUNDARY_THICKNESS],
  [0, -ARENA_HALF_SIZE - BOUNDARY_THICKNESS / 2, ARENA_HALF_SIZE * 2 + BOUNDARY_THICKNESS * 2, BOUNDARY_THICKNESS],
  [ARENA_HALF_SIZE + BOUNDARY_THICKNESS / 2, 0, BOUNDARY_THICKNESS, ARENA_HALF_SIZE * 2],
  [-ARENA_HALF_SIZE - BOUNDARY_THICKNESS / 2, 0, BOUNDARY_THICKNESS, ARENA_HALF_SIZE * 2],
];

// Sparse point-grid on the floor at the grid-line intersections (y=0.01 to
// dodge z-fighting with the floor plane), matching the reference screenshots'
// black ground scattered with small pale dots — not solid grid lines.
function buildDotGrid(color: number): THREE.Points {
  const positions: number[] = [];
  for (let x = -ARENA_HALF_SIZE; x <= ARENA_HALF_SIZE; x += DOT_GRID_SPACING) {
    for (let z = -ARENA_HALF_SIZE; z <= ARENA_HALF_SIZE; z += DOT_GRID_SPACING) {
      positions.push(x, 0.01, z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // sizeAttenuation off: uniform tiny pixel dots regardless of distance,
  // matching the original's flat, non-perspective-scaled floor speckle.
  const mat = new THREE.PointsMaterial({ color, size: DOT_GRID_SIZE, sizeAttenuation: false });
  return new THREE.Points(geo, mat);
}

// Static starfield scattered across the upper hemisphere, well outside the
// arena. Independent of theme — stars don't change per level.
function buildStarfield(): THREE.Points {
  const positions: number[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const elevation = Math.pow(Math.random(), 0.5) * 0.85 + 0.05; // biased low, thinned at zenith
    const phi = elevation * (Math.PI / 2);
    const horizontalR = STAR_DOME_RADIUS * Math.cos(phi);
    positions.push(horizontalR * Math.cos(theta), STAR_DOME_RADIUS * Math.sin(phi), horizontalR * Math.sin(theta));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: STAR_POINT_SIZE, sizeAttenuation: false });
  return new THREE.Points(geo, mat);
}

// Bakes a vertical gradient into a box's vertex colors: brightest (peakColor)
// at the bottom (y = -height/2, i.e. ground level once positioned), fading to
// baseColor at the top — the horizon "glow" reads brightest where it meets
// the ground and dies out into the black sky above it.
function paintVerticalGradient(geometry: THREE.BoxGeometry, height: number, peakColor: number, baseColor: number): void {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const peak = new THREE.Color(peakColor);
  const base = new THREE.Color(baseColor);
  const mixed = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / height + 0.5, 0, 1); // 0 at bottom, 1 at top
    mixed.copy(peak).lerp(base, t);
    colors[i * 3] = mixed.r;
    colors[i * 3 + 1] = mixed.g;
    colors[i * 3 + 2] = mixed.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Four tall gradient walls ringing the arena boundary, viewed from inside
// (BackSide) — stands in for the horizon glow band in the reference shots.
// Purely visual: the sim's containInArena() clamps on ARENA_HALF_SIZE
// directly and never looks at this geometry.
function buildHorizonBand(theme: Theme): THREE.Group {
  const group = new THREE.Group();
  for (const [x, z, sx, sz] of BOUNDARY_SPANS) {
    const geo = new THREE.BoxGeometry(sx, HORIZON_BAND_HEIGHT, sz);
    paintVerticalGradient(geo, HORIZON_BAND_HEIGHT, theme.horizonPeak, theme.horizonBase);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
    mesh.position.set(x, HORIZON_BAND_HEIGHT / 2, z);
    group.add(mesh);
  }
  return group;
}

function disposeGroup(group: THREE.Group): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
}

// Flat black floor + sparse dot-grid + gradient horizon band + static
// starfield. Boundary collision is handled entirely in sim/ via
// ARENA_HALF_SIZE; everything here is presentation only.
export function buildArena(scene: THREE.Scene, initialTheme: Theme): ArenaControls {
  scene.background = new THREE.Color(initialTheme.sky);

  const floorGeo = new THREE.PlaneGeometry(ARENA_HALF_SIZE * 2, ARENA_HALF_SIZE * 2);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshBasicMaterial({ color: initialTheme.ground });
  scene.add(new THREE.Mesh(floorGeo, floorMat));

  let dotGrid = buildDotGrid(initialTheme.dotColor);
  scene.add(dotGrid);

  scene.add(buildStarfield());

  let horizonGroup = buildHorizonBand(initialTheme);
  scene.add(horizonGroup);

  function setTheme(theme: Theme): void {
    scene.background = new THREE.Color(theme.sky);
    floorMat.color.set(theme.ground);

    scene.remove(dotGrid);
    dotGrid.geometry.dispose();
    (dotGrid.material as THREE.Material).dispose();
    dotGrid = buildDotGrid(theme.dotColor);
    scene.add(dotGrid);

    scene.remove(horizonGroup);
    disposeGroup(horizonGroup);
    horizonGroup = buildHorizonBand(theme);
    scene.add(horizonGroup);
  }

  return { setTheme };
}
