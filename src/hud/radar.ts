// Egocentric radar: a small transparent canvas, no bezel, upper-right of the
// viewport (see style.css). Rotates with the player's heading so "forward"
// always points up; draws colored dots for enemies/hunters/flags plus a
// green center dot for the player.

import type { GameState } from '../sim/types.ts';

const RADAR_RANGE = 80; // world units from center to the canvas edge
const DOT_RADIUS_ENEMY = 2.2;
const DOT_RADIUS_FLAG = 1.6;
const DOT_RADIUS_PLAYER = 2.6;

export class Radar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.getElementById('radar') as HTMLCanvasElement;
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

  update(state: GameState): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const scale = (Math.min(w, h) / 2 - 4) / RADAR_RANGE;
    const heading = state.player.heading;
    const player = state.player;

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
      const dx = enemy.position.x - player.position.x;
      const dz = enemy.position.z - player.position.z;
      if (dx * dx + dz * dz > RADAR_RANGE * RADAR_RANGE) continue;
      draw(dx, dz, DOT_RADIUS_ENEMY, enemy.kind === 'hunter' ? '#ff8833' : '#ff3333');
    }

    for (const flag of state.flags) {
      if (flag.collected) continue;
      const dx = flag.position.x - player.position.x;
      const dz = flag.position.z - player.position.z;
      if (dx * dx + dz * dz > RADAR_RANGE * RADAR_RANGE) continue;
      draw(dx, dz, DOT_RADIUS_FLAG, '#ffee88');
    }

    ctx.fillStyle = '#33ff55';
    ctx.beginPath();
    ctx.arc(cx, cy, DOT_RADIUS_PLAYER, 0, Math.PI * 2);
    ctx.fill();
  }
}
