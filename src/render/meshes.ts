// Procedural low-poly geometry: flat-shaded via baked per-face vertex colors
// on unlit materials, plus EdgesGeometry black outlines — the "Tron-like"
// retro look, not single-flat-color blobs.

import * as THREE from 'three';
import type { Theme } from '../config/palette.ts';
import type { PickupKind, WallObstacle, WindmillObstacle } from '../sim/types.ts';
import {
  OBSTACLE_WALL_HEIGHT,
  RENDER_FILLED,
  TANK_HEIGHT,
  TANK_LENGTH,
  TANK_ROOF_INSET_NOSE,
  TANK_ROOF_INSET_SIDE,
  TANK_WIDTH,
} from '../config/constants.ts';

const OUTLINE_MATERIAL = new THREE.LineBasicMaterial({ color: 0x000000 });

// --- Runtime "Filled" toggle (the original's menu button) ---
// RENDER_FILLED is only the *default*; every vertex-color material this
// module creates is tracked here so setFilledMode() can flip `.wireframe`
// on all of them live, including ones built before the toggle was ever
// touched (tank hulls use their own inline MeshBasicMaterial rather than
// basicVertexColorMaterial(), so they register via trackMaterial() too).
let filledMode = RENDER_FILLED;
const trackedMaterials = new Set<THREE.MeshBasicMaterial>();

function trackMaterial(mat: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  trackedMaterials.add(mat);
  return mat;
}

export function isFilledMode(): boolean {
  return filledMode;
}

export function setFilledMode(filled: boolean): void {
  filledMode = filled;
  for (const mat of trackedMaterials) mat.wireframe = !filled;
}

function basicVertexColorMaterial(): THREE.MeshBasicMaterial {
  return trackMaterial(new THREE.MeshBasicMaterial({ vertexColors: true, wireframe: !filledMode }));
}

function paintBoxByNormal(geometry: THREE.BoxGeometry, top: number, side: number, front: number): void {
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < normals.count; i++) {
    const ny = normals.getY(i);
    const nz = normals.getZ(i);
    if (ny > 0.5) c.set(top);
    else if (nz > 0.5) c.set(front);
    else if (ny < -0.5) c.set(side).multiplyScalar(0.55);
    else c.set(side);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function coloredBox(width: number, height: number, depth: number, top: number, side: number, front: number): THREE.Group {
  const geo = new THREE.BoxGeometry(width, height, depth);
  paintBoxByNormal(geo, top, side, front);
  const mesh = new THREE.Mesh(geo, basicVertexColorMaterial());
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geo), OUTLINE_MATERIAL);
  const group = new THREE.Group();
  group.add(mesh, outline);
  return group;
}

// --- Flat-shaded arbitrary-face geometry, used for the tank wedge hull ---

interface ColoredTriFace {
  points: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  color: number;
}

function pushQuad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: number, out: ColoredTriFace[]): void {
  out.push({ points: [a, b, c], color });
  out.push({ points: [a, c, d], color });
}

function flatShadedGeometry(faces: ColoredTriFace[]): THREE.BufferGeometry {
  const positions = new Float32Array(faces.length * 9);
  const colors = new Float32Array(faces.length * 9);
  const c = new THREE.Color();
  faces.forEach((face, fi) => {
    c.set(face.color);
    face.points.forEach((p, vi) => {
      const idx = (fi * 3 + vi) * 3;
      positions[idx] = p.x;
      positions[idx + 1] = p.y;
      positions[idx + 2] = p.z;
      colors[idx] = c.r;
      colors[idx + 1] = c.g;
      colors[idx + 2] = c.b;
    });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Not needed for shading (MeshBasicMaterial is unlit) or for EdgesGeometry
  // (which derives its own face normals from position data), but cheap and
  // keeps the geometry well-formed for any future lit-material use.
  geo.computeVertexNormals();
  return geo;
}

export interface TankColors {
  top: number;
  side: number;
  front: number;
}

// Low, wide arrow/wedge hull: a pointed nose tapering from a wide "wing"
// section back to a narrower flat tail, in plan view. The roof's nose corner
// is pulled sharply back toward the tail (TANK_ROOF_INSET_NOSE) while its
// wing/tail corners stay nearly flush with the base (TANK_ROOF_INSET_SIDE) —
// so the two nose-facing side walls become a steep sloped ramp while the
// flanks and rear stay near-vertical, reading as a flat wedge with a sloped
// nose rather than a faceted gem tapering evenly on all sides.
export interface TankMeshOptions {
  // Narrower + taller reads as a sleeker "cone-ish" hull — used for orange
  // hunters (level 6+) to visually distinguish them from standard red drones
  // without a whole second geometry builder.
  widthScale?: number;
  heightScale?: number;
}

// Parameterized purely by color (+ optional silhouette scale) so Phase B can
// reuse it for red/orange enemies.
export function buildTankMesh(colors: TankColors, options: TankMeshOptions = {}): THREE.Group {
  const hl = TANK_LENGTH / 2;
  const hw = TANK_WIDTH / 2;
  const wingZ = hl * 0.15;

  const base = {
    nose: new THREE.Vector3(0, 0, hl),
    rWing: new THREE.Vector3(hw, 0, wingZ),
    rTail: new THREE.Vector3(hw * 0.5, 0, -hl),
    lTail: new THREE.Vector3(-hw * 0.5, 0, -hl),
    lWing: new THREE.Vector3(-hw, 0, wingZ),
  };
  const inset = (v: THREE.Vector3, fraction: number): THREE.Vector3 => v.clone().multiplyScalar(1 - fraction);
  const roof = {
    nose: inset(base.nose, TANK_ROOF_INSET_NOSE),
    rWing: inset(base.rWing, TANK_ROOF_INSET_SIDE),
    rTail: inset(base.rTail, TANK_ROOF_INSET_SIDE),
    lTail: inset(base.lTail, TANK_ROOF_INSET_SIDE),
    lWing: inset(base.lWing, TANK_ROOF_INSET_SIDE),
  };
  const at = (v: THREE.Vector3, y: number): THREE.Vector3 => new THREE.Vector3(v.x, y, v.z);

  const y0 = 0;
  const y1 = TANK_HEIGHT;
  const bottomShade = new THREE.Color(colors.side).multiplyScalar(0.55).getHex();
  const rearShade = new THREE.Color(colors.side).multiplyScalar(0.7).getHex();

  const faces: ColoredTriFace[] = [
    // roof (inset footprint)
    { points: [at(roof.nose, y1), at(roof.rWing, y1), at(roof.rTail, y1)], color: colors.top },
    { points: [at(roof.nose, y1), at(roof.rTail, y1), at(roof.lTail, y1)], color: colors.top },
    { points: [at(roof.nose, y1), at(roof.lTail, y1), at(roof.lWing, y1)], color: colors.top },
    // belly (full footprint)
    { points: [at(base.nose, y0), at(base.rTail, y0), at(base.rWing, y0)], color: bottomShade },
    { points: [at(base.nose, y0), at(base.lTail, y0), at(base.rTail, y0)], color: bottomShade },
    { points: [at(base.nose, y0), at(base.lWing, y0), at(base.lTail, y0)], color: bottomShade },
  ];
  // beveled side walls (base edge -> inset roof edge): bright nose-facing
  // edges, mid-tone flanks, dim rear
  pushQuad(at(base.nose, y0), at(base.rWing, y0), at(roof.rWing, y1), at(roof.nose, y1), colors.front, faces);
  pushQuad(at(base.rWing, y0), at(base.rTail, y0), at(roof.rTail, y1), at(roof.rWing, y1), colors.side, faces);
  pushQuad(at(base.rTail, y0), at(base.lTail, y0), at(roof.lTail, y1), at(roof.rTail, y1), rearShade, faces);
  pushQuad(at(base.lTail, y0), at(base.lWing, y0), at(roof.lWing, y1), at(roof.lTail, y1), colors.side, faces);
  pushQuad(at(base.lWing, y0), at(base.nose, y0), at(roof.nose, y1), at(roof.lWing, y1), colors.front, faces);

  const geo = flatShadedGeometry(faces);
  const mesh = new THREE.Mesh(
    geo,
    trackMaterial(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, wireframe: !filledMode })),
  );
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geo), OUTLINE_MATERIAL);
  const group = new THREE.Group();
  group.add(mesh, outline);
  if (options.widthScale !== undefined || options.heightScale !== undefined) {
    group.scale.set(options.widthScale ?? 1, options.heightScale ?? 1, 1);
  }
  return group;
}

export function buildWallMesh(obstacle: WallObstacle, theme: Theme): THREE.Group {
  const sizeX = obstacle.max.x - obstacle.min.x;
  const sizeZ = obstacle.max.z - obstacle.min.z;
  const group = coloredBox(sizeX, OBSTACLE_WALL_HEIGHT, sizeZ, theme.wallTop, theme.wallSide, theme.wallFront);
  group.position.set(
    (obstacle.min.x + obstacle.max.x) / 2,
    OBSTACLE_WALL_HEIGHT / 2,
    (obstacle.min.z + obstacle.max.z) / 2,
  );
  return group;
}

export function buildWindmillMesh(
  obstacle: WindmillObstacle,
  theme: Theme,
): { group: THREE.Group; blades: THREE.Group } {
  const group = new THREE.Group();

  const pylonHeight = obstacle.bladeLength * 0.9;
  const pylon = coloredBox(
    obstacle.pylonRadius * 1.6,
    pylonHeight,
    obstacle.pylonRadius * 1.6,
    theme.windmillTop,
    theme.windmillSide,
    theme.windmillSide,
  );
  pylon.position.y = pylonHeight / 2;
  group.add(pylon);

  // Fan blades sit in a VERTICAL plane with a fixed facing (+Z — the sim
  // gives windmills no orientation of their own, and the reference
  // screenshots don't settle which way they should face, so a fixed axis is
  // as principled as any) and spin about the horizontal Z axis, reading as a
  // classic pinwheel/fan rather than a helicopter rotor spinning flat overhead.
  // Hub is raised to bladeLength (above the pylon top) so the vertical blade
  // sweep clears the ground instead of dipping below it.
  const blades = new THREE.Group();
  const hubHeight = obstacle.bladeLength;
  blades.position.y = hubHeight;
  const bladeCount = 4;
  for (let i = 0; i < bladeCount; i++) {
    // Blade extends along local Y from the hub; each pivot is spread by
    // rotating about Z, so the 4 blades sweep the vertical XY plane.
    const blade = coloredBox(0.4, obstacle.bladeLength, 0.4, theme.windmillBlade, theme.windmillBlade, theme.windmillBlade);
    blade.position.y = obstacle.bladeLength / 2;
    const pivot = new THREE.Group();
    pivot.rotation.z = (i / bladeCount) * Math.PI * 2;
    pivot.add(blade);
    blades.add(pivot);
  }
  blades.rotation.z = obstacle.bladeAngle;
  group.add(blades);

  group.position.set(obstacle.position.x, 0, obstacle.position.z);
  return { group, blades };
}

export function buildFlagMesh(theme: Theme): THREE.Group {
  const group = new THREE.Group();

  const pole = coloredBox(0.12, 3, 0.12, 0xcccccc, 0x999999, 0x999999);
  pole.position.y = 1.5;
  group.add(pole);

  const cloth = coloredBox(1.1, 0.6, 0.05, theme.flag, theme.flag, theme.flag);
  cloth.position.set(0.6, 2.6, 0);
  group.add(cloth);

  return group;
}

export function buildPickupMesh(kind: PickupKind, theme: Theme): THREE.Group {
  const color = kind === 'ammo' ? theme.ammoPickup : theme.shieldPickup;
  const geo =
    kind === 'ammo'
      ? new THREE.CylinderGeometry(0.5, 0.5, 1.0, 8)
      : new THREE.OctahedronGeometry(0.7);
  geo.computeVertexNormals();
  const colors = new Float32Array(geo.getAttribute('position').count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(geo, basicVertexColorMaterial());
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geo), OUTLINE_MATERIAL);
  const group = new THREE.Group();
  group.add(mesh, outline);
  group.position.y = 0.8;
  return group;
}
