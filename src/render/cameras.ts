import * as THREE from 'three';
import { ARENA_HALF_SIZE, CHASE_DISTANCE, CHASE_HEIGHT, CHASE_LOOKAHEAD, CHASE_SMOOTHING, TANK_RADIUS } from '../config/constants.ts';

const FORWARD = new THREE.Vector3();
const DESIRED_POS = new THREE.Vector3();
const DESIRED_LOOK_AT = new THREE.Vector3();

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

  update(targetPosition: THREE.Vector3, targetHeading: number, dt: number): void {
    FORWARD.set(Math.sin(targetHeading), 0, Math.cos(targetHeading));
    DESIRED_POS.copy(targetPosition).addScaledVector(FORWARD, -CHASE_DISTANCE);
    DESIRED_POS.y += CHASE_HEIGHT;
    DESIRED_LOOK_AT.copy(targetPosition).addScaledVector(FORWARD, CHASE_LOOKAHEAD);
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

  update(targetPosition: THREE.Vector3, targetHeading: number, dt: number): void {
    switch (this.mode) {
      case 'chase':
        this.chase.update(targetPosition, targetHeading, dt);
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
