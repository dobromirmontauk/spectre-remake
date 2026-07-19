import type { GameState } from '../sim/types.ts';
import type { GameFlow } from '../game/flow.ts';
import { FLAGS_PER_LEVEL } from '../config/constants.ts';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`HUD element #${id} not found`);
  return el as T;
}

function pad(n: number, width: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(width, '0');
}

// Live DOM gauges — updated only when the underlying value changes.
export class Hud {
  private levelEl = requireEl<HTMLElement>('hud-level');
  private flagsEl = requireEl<HTMLElement>('hud-flags');
  private livesEl = requireEl<HTMLElement>('hud-lives');
  private scoreEl = requireEl<HTMLElement>('hud-score');
  private bonusEl = requireEl<HTMLElement>('hud-bonus');
  private damageFillEl = requireEl<HTMLElement>('hud-damage-fill');
  private ammoFillEl = requireEl<HTMLElement>('hud-ammo-fill');
  private ammoEl = requireEl<HTMLElement>('hud-ammo');
  private shieldFillEl = requireEl<HTMLElement>('hud-shield-fill');
  private speedEl = requireEl<HTMLElement>('hud-speed');
  private muteEl = requireEl<HTMLElement>('hud-mute');
  private overlayLayer = requireEl<HTMLElement>('overlay-layer');
  private levelCardEl: HTMLDivElement | null = null;
  private pausedCardEl: HTMLDivElement | null = null;

  private lastLevel = -1;
  private lastFlags = -1;
  private lastLives = -1;
  private lastScore = -1;
  private lastBonus = -1;
  private lastShieldPct = -1;
  private lastAmmo = -1;
  private lastSpeed = -1;

  updateMute(muted: boolean): void {
    this.muteEl.textContent = muted ? 'MUTED (S)' : '';
  }

  update(state: GameState, flow: GameFlow): void {
    if (state.level !== this.lastLevel) {
      this.levelEl.textContent = pad(state.level, 2);
      this.lastLevel = state.level;
    }

    if (state.flagsCollected !== this.lastFlags) {
      this.flagsEl.textContent = `${state.flagsCollected}/${FLAGS_PER_LEVEL}`;
      this.lastFlags = state.flagsCollected;
    }

    if (state.lives !== this.lastLives) {
      this.livesEl.textContent = String(Math.max(0, state.lives));
      this.lastLives = state.lives;
    }

    if (state.score !== this.lastScore) {
      this.scoreEl.textContent = pad(state.score, 4);
      this.lastScore = state.score;
    }

    if (state.bonusRemaining !== this.lastBonus) {
      this.bonusEl.textContent = pad(state.bonusRemaining, 3);
      this.lastBonus = state.bonusRemaining;
    }

    const shieldPct = Math.round((state.player.shield / state.player.maxShield) * 100);
    if (shieldPct !== this.lastShieldPct) {
      this.damageFillEl.style.width = `${100 - shieldPct}%`;
      this.shieldFillEl.style.height = `${shieldPct}%`;
      this.lastShieldPct = shieldPct;
    }

    const ammo = Math.round(state.player.ammo);
    if (ammo !== this.lastAmmo) {
      this.ammoEl.textContent = String(ammo);
      this.ammoFillEl.style.width = `${(ammo / state.player.maxAmmo) * 100}%`;
      this.lastAmmo = ammo;
    }

    const speed = Math.round(Math.abs(state.player.speed) * 10) / 10;
    if (speed !== this.lastSpeed) {
      this.speedEl.textContent = speed.toFixed(1);
      this.lastSpeed = speed;
    }

    this.updateLevelCard(flow, state.level);
    this.updatePausedCard(flow);
  }

  private updateLevelCard(flow: GameFlow, level: number): void {
    if (flow.showLevelIntro) {
      if (!this.levelCardEl) {
        this.levelCardEl = document.createElement('div');
        this.levelCardEl.className = 'level-card';
        this.overlayLayer.appendChild(this.levelCardEl);
      }
      this.levelCardEl.textContent = `LEVEL ${level}`;
    } else if (this.levelCardEl) {
      this.levelCardEl.remove();
      this.levelCardEl = null;
    }
  }

  private updatePausedCard(flow: GameFlow): void {
    if (flow.showPaused) {
      if (!this.pausedCardEl) {
        this.pausedCardEl = document.createElement('div');
        this.pausedCardEl.className = 'paused-card';
        this.pausedCardEl.textContent = 'PAUSED';
        this.overlayLayer.appendChild(this.pausedCardEl);
      }
    } else if (this.pausedCardEl) {
      this.pausedCardEl.remove();
      this.pausedCardEl = null;
    }
  }
}
