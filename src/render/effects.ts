// Muzzle flashes, tracers, impact flashes, explosions, grenade blast rings.
// Purely cosmetic and purely event-driven (SimEvents ShotFired/ShotHit/
// EnemyDestroyed/PlayerDestroyed/GrenadeExploded) — no sim coupling, no
// simulation state is read here beyond the event payloads themselves.

import * as THREE from 'three';
import type { SimEvent } from '../sim/events.ts';
import type { Vec2 } from '../sim/types.ts';

interface Transient {
  object: THREE.Object3D;
  age: number;
  lifetime: number;
  onUpdate: (t: number, object: THREE.Object3D) => void;
  dispose: () => void;
}

const TRACER_LIFETIME = 0.14; // seconds — a fast bright streak, not a tracked projectile
const TRACER_VISUAL_SPEED = 70; // world units/sec, matches PROJECTILE_SPEED for a consistent feel
const MUZZLE_FLASH_LIFETIME = 0.08;
const IMPACT_FLASH_LIFETIME = 0.16;
const EXPLOSION_LIFETIME = 0.45;
const GRENADE_BLAST_RING_LIFETIME = 0.35;

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh | THREE.LineSegments;
    if ('geometry' in mesh && mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as THREE.Mesh).material;
    if (material) {
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
  });
}

export class EffectsManager {
  private scene: THREE.Scene;
  private transients: Transient[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private spawn(object: THREE.Object3D, lifetime: number, onUpdate: (t: number, object: THREE.Object3D) => void): void {
    this.scene.add(object);
    this.transients.push({ object, age: 0, lifetime, onUpdate, dispose: () => disposeObject(object) });
  }

  private muzzleFlash(position: Vec2, heading: number): void {
    const geo = new THREE.SphereGeometry(0.45, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff6b0, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    const offset = 0.6;
    mesh.position.set(position.x + Math.sin(heading) * offset, 0.4, position.z + Math.cos(heading) * offset);
    this.spawn(mesh, MUZZLE_FLASH_LIFETIME, (t) => {
      mat.opacity = 1 - t;
      const s = 1 + t * 0.6;
      mesh.scale.set(s, s, s);
    });
  }

  private tracer(position: Vec2, heading: number): void {
    const length = 3;
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, length)];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xccffcc, transparent: true, opacity: 1 });
    const line = new THREE.LineSegments(geo, mat);
    line.rotation.y = heading;
    line.position.set(position.x, 0.4, position.z);
    this.spawn(line, TRACER_LIFETIME, (t) => {
      const traveled = TRACER_VISUAL_SPEED * t * TRACER_LIFETIME;
      line.position.set(
        position.x + Math.sin(heading) * traveled,
        0.4,
        position.z + Math.cos(heading) * traveled,
      );
      mat.opacity = 1 - t;
    });
  }

  private impactFlash(position: Vec2): void {
    const geo = new THREE.SphereGeometry(0.3, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(position.x, 0.4, position.z);
    this.spawn(mesh, IMPACT_FLASH_LIFETIME, (t) => {
      const s = 1 + t * 3;
      mesh.scale.set(s, s, s);
      mat.opacity = 1 - t;
    });
  }

  private explosion(position: Vec2): void {
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa33, wireframe: true, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(position.x, 1, position.z);
    this.spawn(mesh, EXPLOSION_LIFETIME, (t) => {
      const s = 1 + t * 5;
      mesh.scale.set(s, s, s);
      mat.opacity = 1 - t;
      mat.color.setHSL(0.11 - t * 0.05, 1, 0.6 - t * 0.3);
    });
  }

  private grenadeBlastRing(position: Vec2, radius: number): void {
    const geo = new THREE.RingGeometry(0.1, 0.4, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8833, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(position.x, 0.15, position.z);
    this.spawn(mesh, GRENADE_BLAST_RING_LIFETIME, (t) => {
      const s = (radius / 0.4) * Math.max(t, 0.05);
      mesh.scale.set(s, 1, s);
      mat.opacity = 0.85 * (1 - t);
    });
  }

  // Call once per render frame with this tick's freshly-drained SimEvents
  // and the frame delta (seconds).
  update(events: SimEvent[], dt: number): void {
    for (const event of events) {
      switch (event.type) {
        case 'ShotFired':
          this.muzzleFlash(event.position, event.heading);
          this.tracer(event.position, event.heading);
          break;
        case 'ShotHit':
          if (event.targetKind !== 'bounds') this.impactFlash(event.position);
          break;
        case 'GrenadeFired':
          this.muzzleFlash(event.position, event.heading);
          break;
        case 'GrenadeExploded':
          this.grenadeBlastRing(event.position, event.radius);
          break;
        case 'EnemyDestroyed':
        case 'PlayerDestroyed':
          this.explosion(event.position);
          break;
        default:
          break;
      }
    }

    for (let i = this.transients.length - 1; i >= 0; i--) {
      const fx = this.transients[i]!;
      fx.age += dt;
      const t = Math.min(1, fx.age / fx.lifetime);
      fx.onUpdate(t, fx.object);
      if (fx.age >= fx.lifetime) {
        this.scene.remove(fx.object);
        fx.dispose();
        this.transients.splice(i, 1);
      }
    }
  }
}
