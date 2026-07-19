// Egocentric radar: a small transparent canvas, no bezel, upper-right of the
// viewport (see style.css). Rotates with the viewer's heading so "forward"
// always points up; draws colored dots for enemies/hunters/flags plus a
// green center dot for the viewer. In 2P modes, one Radar instance is
// instantiated per viewport (see game/app.ts) — each is centered on its own
// player and, in duel mode, shows the opposing tank as a threat dot instead
// of (nonexistent) flags.

import type { GameState, TankState } from '../sim/types.ts';

const RADAR_RANGE = 80; // world units from center to the canvas edge
const DOT_RADIUS_ENEMY = 2.2;
const DOT_RADIUS_FLAG = 1.6;
const DOT_RADIUS_PLAYER = 2.6;
const DOT_RADIUS_OPPONENT = 2.4;

export class Radar {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('radar canvas has no 2d context');
    this.ctx = ctx;
  }

  // Rotates a world-space offset (dx, dz) from the player into the player's
  // own egocentric frame (forward = screen-up), per the heading convention
  // in sim/types.ts (heading 0 = +z, increasing toward +x).
  private toEgocentric(dx: number, dz: number, heading: number): { x: number; z: number } {
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
  }

  update(state: GameState, viewer: TankState = state.player): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const scale = (Math.min(w, h) / 2 - 4) / RADAR_RANGE;
    const heading = viewer.heading;

    const draw = (dx: number, dz: number, radius: number, color: string): void => {
      const local = this.toEgocentric(dx, dz, heading);
      const sx = cx + local.x * scale;
      const sy = cy - local.z * scale;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();
    };

    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.position.x - viewer.position.x;
      const dz = enemy.position.z - viewer.position.z;
      if (dx * dx + dz * dz > RADAR_RANGE * RADAR_RANGE) continue;
      draw(dx, dz, DOT_RADIUS_ENEMY, enemy.kind === 'hunter' ? '#ff8833' : '#ff3333');
    }

    // Duel has no flags/enemies — show the opposing player as the threat dot.
    const opponent = state.mode === 'duel' ? (viewer.id === 'player' ? state.player2 : state.player) : null;
    if (opponent && opponent.alive) {
      const dx = opponent.position.x - viewer.position.x;
      const dz = opponent.position.z - viewer.position.z;
      if (dx * dx + dz * dz <= RADAR_RANGE * RADAR_RANGE) draw(dx, dz, DOT_RADIUS_OPPONENT, '#ff5566');
    }

    for (const flag of state.flags) {
      if (flag.collected) continue;
      const dx = flag.position.x - viewer.position.x;
      const dz = flag.position.z - viewer.position.z;
      if (dx * dx + dz * dz > RADAR_RANGE * RADAR_RANGE) continue;
      draw(dx, dz, DOT_RADIUS_FLAG, '#ffee88');
    }

    ctx.fillStyle = '#33ff55';
    ctx.beginPath();
    ctx.arc(cx, cy, DOT_RADIUS_PLAYER, 0, Math.PI * 2);
    ctx.fill();
  }
}
