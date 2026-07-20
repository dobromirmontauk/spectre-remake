import * as THREE from 'three';
import { ARENA_HALF_SIZE, CHASE_DISTANCE, CHASE_HEIGHT, CHASE_LOOKAHEAD, CHASE_SMOOTHING, TANK_RADIUS } from '../config/constants.ts';
import { segmentVsAABB, segmentVsCircle } from '../sim/collision.ts';
import type { Obstacle } from '../sim/types.ts';

const FORWARD = new THREE.Vector3();
const DESIRED_POS = new THREE.Vector3();
const DESIRED_LOOK_AT = new THREE.Vector3();

// Keep the chase eye this far off any surface, and never let it collapse
// entirely onto the tank (which would clip inside the hull).
const CAMERA_SURFACE_MARGIN = 3;
const CAMERA_MIN_FRACTION = 0.12;

// Fraction of the tank->desired-eye ray (in the 2D ground plane) that stays
// inside the arena and clear of every obstacle. The chase camera pulls its eye
// in by this much so it never ends up behind a wall/pylon or outside the arena
// where the player can't see their own tank. Reuses the sim's pure swept tests
// (read-only — no state mutation), expanding each collider by the margin.
function clearFraction(from: THREE.Vector3, to: THREE.Vector3, obstacles: Obstacle[], halfSize: number): number {
  const a = { x: from.x, z: from.z };
  const b = { x: to.x, z: to.z };
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let t = 1;

  // Arena boundary (shrunk by the margin so the eye stops just inside).
  const lim = halfSize - CAMERA_SURFACE_MARGIN;
  if (dx > 1e-6) t = Math.min(t, (lim - a.x) / dx);
  else if (dx < -1e-6) t = Math.min(t, (-lim - a.x) / dx);
  if (dz > 1e-6) t = Math.min(t, (lim - a.z) / dz);
  else if (dz < -1e-6) t = Math.min(t, (-lim - a.z) / dz);

  const m = CAMERA_SURFACE_MARGIN;
  for (const o of obstacles) {
    const hit =
      o.kind === 'wall'
        ? segmentVsAABB(a, b, { x: o.min.x - m, z: o.min.z - m }, { x: o.max.x + m, z: o.max.z + m })
        : segmentVsCircle(a, b, o.position, o.pylonRadius + m);
    if (hit.hit) t = Math.min(t, hit.t);
  }

  return Math.max(CAMERA_MIN_FRACTION, Math.min(1, t));
}

// Above-and-behind chase camera that follows the player smoothly via
// exponential (frame-rate independent) position/look-at lerping.
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  private currentPos = new THREE.Vector3();
  private currentLookAt = new THREE.Vector3();
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 500);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(targetPosition: THREE.Vector3, targetHeading: number, dt: number, obstacles: Obstacle[] = [], halfSize: number = ARENA_HALF_SIZE): void {
    FORWARD.set(Math.sin(targetHeading), 0, Math.cos(targetHeading));
    DESIRED_POS.copy(targetPosition).addScaledVector(FORWARD, -CHASE_DISTANCE);
    DESIRED_POS.y += CHASE_HEIGHT;

    // Pull the eye in HORIZONTALLY toward the tank if the straight line from
    // the tank to it would exit the arena or cross an obstacle (e.g. the tank
    // backed flat against a wall facing inward — no room behind it). Height is
    // kept at full CHASE_HEIGHT so the jammed camera looks DOWN at the tank and
    // the surrounding floor rather than straight into the perimeter horizon
    // band, and the look-ahead shrinks by the same fraction so the aim tilts
    // toward the tank instead of far across the arena — together that keeps the
    // tank framed near the bottom third instead of dropping off-screen.
    const clear = clearFraction(targetPosition, DESIRED_POS, obstacles, halfSize);
    DESIRED_POS.x = targetPosition.x + (DESIRED_POS.x - targetPosition.x) * clear;
    DESIRED_POS.z = targetPosition.z + (DESIRED_POS.z - targetPosition.z) * clear;

    // Hard safety clamp: the eye must never sit outside the arena, even in the
    // degenerate case where the tank is jammed flat against a wall facing
    // inward (the min-fraction floor above can otherwise leave the eye just
    // past the boundary, staring into the perimeter horizon band). When this
    // pins the eye near/ahead of the tank, the shrunk look-ahead below turns
    // the view top-down — you still see the tank and the floor around it.
    const eyeLim = halfSize - 1;
    DESIRED_POS.x = Math.max(-eyeLim, Math.min(eyeLim, DESIRED_POS.x));
    DESIRED_POS.z = Math.max(-eyeLim, Math.min(eyeLim, DESIRED_POS.z));

    DESIRED_LOOK_AT.copy(targetPosition).addScaledVector(FORWARD, CHASE_LOOKAHEAD * clear);
    DESIRED_LOOK_AT.y = 0;

    if (!this.initialized) {
      this.currentPos.copy(DESIRED_POS);
      this.currentLookAt.copy(DESIRED_LOOK_AT);
      this.initialized = true;
    } else {
      const t = 1 - Math.pow(CHASE_SMOOTHING, dt);
      this.currentPos.lerp(DESIRED_POS, t);
      this.currentLookAt.lerp(DESIRED_LOOK_AT, t);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }
}

// Mounted at the tank's nose, looking straight down its heading — no
// smoothing, it's rigidly attached to the hull like a cockpit view.
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 500);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(targetPosition: THREE.Vector3, targetHeading: number): void {
    FORWARD.set(Math.sin(targetHeading), 0, Math.cos(targetHeading));
    this.camera.position.copy(targetPosition).addScaledVector(FORWARD, TANK_RADIUS * 0.9);
    this.camera.position.y += 0.9;
    DESIRED_LOOK_AT.copy(this.camera.position).addScaledVector(FORWARD, 20);
    this.camera.lookAt(DESIRED_LOOK_AT);
  }
}

// High above the tank, looking straight down, following x/z position only —
// heading does not rotate the view (north stays "up").
export class OverheadFollowCamera {
  readonly camera: THREE.OrthographicCamera;
  private readonly viewHalfSize = 45;

  constructor(aspect: number) {
    this.camera = this.buildCamera(aspect);
  }

  private buildCamera(aspect: number): THREE.OrthographicCamera {
    const h = this.viewHalfSize;
    const w = h * aspect;
    const cam = new THREE.OrthographicCamera(-w, w, h, -h, 0.1, 500);
    cam.up.set(0, 0, -1); // keep +z (world "north") pointing up on screen while looking straight down
    return cam;
  }

  setAspect(aspect: number): void {
    const h = this.viewHalfSize;
    const w = h * aspect;
    this.camera.left = -w;
    this.camera.right = w;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  update(targetPosition: THREE.Vector3): void {
    this.camera.position.set(targetPosition.x, 120, targetPosition.z);
    this.camera.lookAt(targetPosition.x, 0, targetPosition.z);
  }
}

// Fixed high above the arena center, wide enough to frame the whole map —
// static, doesn't follow the player at all.
export class FullMapCamera {
  readonly camera: THREE.OrthographicCamera;
  private readonly viewHalfSize = ARENA_HALF_SIZE + 10;

  constructor(aspect: number) {
    const h = this.viewHalfSize;
    const w = h * aspect;
    this.camera = new THREE.OrthographicCamera(-w, w, h, -h, 0.1, 1000);
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(0, 220, 0);
    this.camera.lookAt(0, 0, 0);
  }

  setAspect(aspect: number): void {
    const h = this.viewHalfSize;
    const w = h * aspect;
    this.camera.left = -w;
    this.camera.right = w;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }
}

export type CameraMode = 'chase' | 'first-person' | 'overhead-follow' | 'full-map';
const CAMERA_ORDER: CameraMode[] = ['chase', 'first-person', 'overhead-follow', 'full-map'];

// Owns all 4 views and cycles between them (Tab). Only one camera's math is
// updated per frame — the active one — chosen by `mode`.
export class CameraRig {
  readonly chase: ChaseCamera;
  readonly firstPerson: FirstPersonCamera;
  readonly overheadFollow: OverheadFollowCamera;
  readonly fullMap: FullMapCamera;

  private modeIndex = 0;

  constructor(aspect: number) {
    this.chase = new ChaseCamera(aspect);
    this.firstPerson = new FirstPersonCamera(aspect);
    this.overheadFollow = new OverheadFollowCamera(aspect);
    this.fullMap = new FullMapCamera(aspect);
  }

  get mode(): CameraMode {
    return CAMERA_ORDER[this.modeIndex]!;
  }

  cycle(): void {
    this.modeIndex = (this.modeIndex + 1) % CAMERA_ORDER.length;
  }

  setAspect(aspect: number): void {
    this.chase.setAspect(aspect);
    this.firstPerson.setAspect(aspect);
    this.overheadFollow.setAspect(aspect);
    this.fullMap.setAspect(aspect);
  }

  get activeCamera(): THREE.Camera {
    switch (this.mode) {
      case 'chase':
        return this.chase.camera;
      case 'first-person':
        return this.firstPerson.camera;
      case 'overhead-follow':
        return this.overheadFollow.camera;
      case 'full-map':
        return this.fullMap.camera;
    }
  }

  update(targetPosition: THREE.Vector3, targetHeading: number, dt: number, obstacles: Obstacle[] = []): void {
    switch (this.mode) {
      case 'chase':
        this.chase.update(targetPosition, targetHeading, dt, obstacles);
        break;
      case 'first-person':
        this.firstPerson.update(targetPosition, targetHeading);
        break;
      case 'overhead-follow':
        this.overheadFollow.update(targetPosition);
        break;
      case 'full-map':
        // Static — nothing to update per frame.
        break;
    }
  }
}
