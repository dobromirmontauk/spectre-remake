import * as THREE from 'three';
import type { EnemyState, GameState } from '../sim/types.ts';
import { buildArena, type ArenaControls } from './arena.ts';
import { buildFlagMesh, buildPickupMesh, buildTankMesh, buildWallMesh, buildWindmillMesh } from './meshes.ts';
import { DRONE_TANK_COLORS, HUNTER_TANK_COLORS, PLAYER2_TANK_COLORS, PLAYER_TANK_COLORS, themeForLevel } from '../config/palette.ts';
import { GRENADE_FUSE_TICKS } from '../config/constants.ts';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

// Mirrors sim state onto Three.js objects. Owns no gameplay logic — purely
// a state-to-scene projection with render-frame interpolation.
export class Renderer {
  readonly playerRenderPosition = new THREE.Vector3();
  playerRenderHeading = 0;
  // Player 2 (2P co-op/duel only) — mirrors playerRenderPosition/Heading so
  // a second chase camera can follow it the same way (see app.ts split-screen).
  readonly player2RenderPosition = new THREE.Vector3();
  player2RenderHeading = 0;

  private scene: THREE.Scene;
  private arenaControls: ArenaControls;
  private playerMesh: THREE.Group;
  private player2Mesh: THREE.Group | null = null;
  private renderedLevel = -1;

  private obstacleMeshes = new Map<string, THREE.Object3D>();
  private windmillBlades = new Map<string, THREE.Object3D>();
  private flagMeshes = new Map<string, THREE.Object3D>();
  private pickupMeshes = new Map<string, THREE.Object3D>();
  private enemyMeshes = new Map<string, THREE.Object3D>();
  private grenadeMeshes = new Map<string, THREE.Object3D>();

  constructor(scene: THREE.Scene, initialState: GameState) {
    this.scene = scene;
    this.arenaControls = buildArena(scene, themeForLevel(initialState.level));

    this.playerMesh = buildTankMesh(PLAYER_TANK_COLORS);
    scene.add(this.playerMesh);

    this.syncLevelObjects(initialState);
  }

  private buildEnemyMesh(enemy: EnemyState): THREE.Object3D {
    return enemy.kind === 'hunter'
      ? buildTankMesh(HUNTER_TANK_COLORS, { widthScale: 0.72, heightScale: 1.8 })
      : buildTankMesh(DRONE_TANK_COLORS);
  }

  private buildGrenadeMesh(): THREE.Object3D {
    const geo = new THREE.OctahedronGeometry(0.5);
    geo.computeVertexNormals();
    const colors = new Float32Array(geo.getAttribute('position').count * 3);
    const c = new THREE.Color(0x333333);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000 }));
    const group = new THREE.Group();
    group.add(mesh, outline);
    return group;
  }

  private syncLevelObjects(state: GameState): void {
    for (const obj of this.obstacleMeshes.values()) this.scene.remove(obj);
    for (const obj of this.flagMeshes.values()) this.scene.remove(obj);
    for (const obj of this.pickupMeshes.values()) this.scene.remove(obj);
    this.obstacleMeshes.clear();
    this.windmillBlades.clear();
    this.flagMeshes.clear();
    this.pickupMeshes.clear();

    const theme = themeForLevel(state.level);
    this.arenaControls.setTheme(theme);

    for (const obstacle of state.obstacles) {
      if (obstacle.kind === 'wall') {
        const mesh = buildWallMesh(obstacle, theme);
        this.scene.add(mesh);
        this.obstacleMeshes.set(obstacle.id, mesh);
      } else {
        const { group, blades } = buildWindmillMesh(obstacle, theme);
        this.scene.add(group);
        this.obstacleMeshes.set(obstacle.id, group);
        this.windmillBlades.set(obstacle.id, blades);
      }
    }

    for (const flag of state.flags) {
      const mesh = buildFlagMesh(theme);
      mesh.position.set(flag.position.x, 0, flag.position.z);
      this.scene.add(mesh);
      this.flagMeshes.set(flag.id, mesh);
    }

    for (const pickup of state.pickups) {
      const mesh = buildPickupMesh(pickup.kind, theme);
      mesh.position.set(pickup.position.x, mesh.position.y, pickup.position.z);
      this.scene.add(mesh);
      this.pickupMeshes.set(pickup.id, mesh);
    }

    this.renderedLevel = state.level;
  }

  update(state: GameState, alpha: number, frameTimeSeconds: number): void {
    if (state.level !== this.renderedLevel) {
      this.syncLevelObjects(state);
    }

    const p = state.player;
    this.playerRenderPosition.set(lerp(p.prevPosition.x, p.position.x, alpha), 0, lerp(p.prevPosition.z, p.position.z, alpha));
    this.playerRenderHeading = lerpAngle(p.prevHeading, p.heading, alpha);
    this.playerMesh.position.copy(this.playerRenderPosition);
    this.playerMesh.rotation.y = this.playerRenderHeading;
    // Brief post-respawn invulnerability blink: toggle visibility a few times
    // a second rather than a steady fade — reads clearly as "temporarily safe".
    // `p.alive` matters in duel mode, where a player can be legitimately dead
    // for a couple of seconds awaiting respawn while the match continues.
    const p1Blinking = p.invulnerableTicks <= 0 || Math.floor(frameTimeSeconds * 8) % 2 === 0;
    this.playerMesh.visible = p.alive && p1Blinking;

    this.reconcilePlayer2(state, alpha, frameTimeSeconds);

    for (const obstacle of state.obstacles) {
      if (obstacle.kind !== 'windmill') continue;
      const blades = this.windmillBlades.get(obstacle.id);
      if (blades) blades.rotation.z = lerpAngle(obstacle.prevBladeAngle, obstacle.bladeAngle, alpha);
    }

    for (const flag of state.flags) {
      const mesh = this.flagMeshes.get(flag.id);
      if (mesh) mesh.visible = !flag.collected;
    }

    for (const pickup of state.pickups) {
      const mesh = this.pickupMeshes.get(pickup.id);
      if (mesh) mesh.visible = !pickup.collected;
    }

    this.reconcileEnemies(state, alpha);
    this.reconcileGrenades(state);
  }

  // Builds/tears down player2's mesh as state.player2 comes and goes (mode
  // switches always go through a full resetGameWithLoadout, which recreates
  // or nulls it out) and mirrors it the same way the solo player mesh works.
  private reconcilePlayer2(state: GameState, alpha: number, frameTimeSeconds: number): void {
    const p2 = state.player2;
    if (!p2) {
      if (this.player2Mesh) {
        this.scene.remove(this.player2Mesh);
        this.player2Mesh = null;
      }
      return;
    }
    if (!this.player2Mesh) {
      this.player2Mesh = buildTankMesh(PLAYER2_TANK_COLORS);
      this.scene.add(this.player2Mesh);
    }
    this.player2RenderPosition.set(lerp(p2.prevPosition.x, p2.position.x, alpha), 0, lerp(p2.prevPosition.z, p2.position.z, alpha));
    this.player2RenderHeading = lerpAngle(p2.prevHeading, p2.heading, alpha);
    this.player2Mesh.position.copy(this.player2RenderPosition);
    this.player2Mesh.rotation.y = this.player2RenderHeading;
    const blinking = p2.invulnerableTicks <= 0 || Math.floor(frameTimeSeconds * 8) % 2 === 0;
    this.player2Mesh.visible = p2.alive && blinking;
  }

  private reconcileEnemies(state: GameState, alpha: number): void {
    const seen = new Set<string>();
    for (const enemy of state.enemies) {
      seen.add(enemy.id);
      let mesh = this.enemyMeshes.get(enemy.id);
      if (!mesh) {
        mesh = this.buildEnemyMesh(enemy);
        this.scene.add(mesh);
        this.enemyMeshes.set(enemy.id, mesh);
      }
      mesh.visible = enemy.alive;
      if (!enemy.alive) continue;
      mesh.position.set(lerp(enemy.prevPosition.x, enemy.position.x, alpha), 0, lerp(enemy.prevPosition.z, enemy.position.z, alpha));
      mesh.rotation.y = lerpAngle(enemy.prevHeading, enemy.heading, alpha);
    }

    for (const [id, mesh] of this.enemyMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      this.enemyMeshes.delete(id);
    }
  }

  private reconcileGrenades(state: GameState): void {
    const seen = new Set<string>();
    const arcHeight = 2.5;
    for (const grenade of state.grenades) {
      seen.add(grenade.id);
      let mesh = this.grenadeMeshes.get(grenade.id);
      if (!mesh) {
        mesh = this.buildGrenadeMesh();
        this.scene.add(mesh);
        this.grenadeMeshes.set(grenade.id, mesh);
      }
      // Cosmetic lob arc: the sim itself flies grenades in a straight 2D
      // line, so the "arc" is purely a vertical bob synced to the fuse
      // timer — tied to real sim data (no desync) rather than an untracked
      // decorative effect.
      const progress = 1 - grenade.fuseTicksRemaining / GRENADE_FUSE_TICKS;
      const height = Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI) * arcHeight + 0.5;
      mesh.position.set(grenade.position.x, height, grenade.position.z);
    }

    for (const [id, mesh] of this.grenadeMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      this.grenadeMeshes.delete(id);
    }
  }
}
