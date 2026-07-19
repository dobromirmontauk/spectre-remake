// Compact per-player HUD for 2P co-op/duel: lives/damage/ammo readouts at
// top-left (P1) and top-right (P2), plus a shared center block (Score/Level/
// Flags in co-op, kill tally in duel). Built as its own DOM tree (appended to
// #stage by game/app.ts) rather than touching the solo #hud-top markup, so
// 1-player behavior/layout is completely untouched; app.ts shows this HUD
// instead of the solo Hud whenever state.player2 is non-null.

import type { GameState, TankState } from '../sim/types.ts';
import { DUEL_KILL_TARGET, FLAGS_PER_LEVEL } from '../config/constants.ts';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

interface PlayerPanel {
  root: HTMLDivElement;
  livesEl: HTMLSpanElement;
  livesRow: HTMLDivElement;
  damageFillEl: HTMLSpanElement;
  ammoFillEl: HTMLSpanElement;
  ammoEl: HTMLSpanElement;
}

export class Hud2P {
  private root: HTMLDivElement;
  private left: PlayerPanel;
  private right: PlayerPanel;
  private centerEl: HTMLDivElement;

  constructor(stage: HTMLElement) {
    this.root = el('div', 'hud2p-top');
    this.left = this.buildPanel('hud2p-panel hud2p-left', 'P1');
    this.right = this.buildPanel('hud2p-panel hud2p-right', 'P2');
    this.centerEl = el('div', 'hud2p-center');
    this.root.append(this.left.root, this.centerEl, this.right.root);
    stage.appendChild(this.root);
  }

  private row(labelText: string): { row: HTMLDivElement; valueEl: HTMLSpanElement } {
    const row = el('div', 'hud2p-row');
    const label = el('span', 'hud2p-label');
    label.textContent = labelText;
    const valueEl = el('span', 'hud2p-value');
    row.append(label, valueEl);
    return { row, valueEl };
  }

  private bar(kind: 'damage' | 'ammo', trailingValue: boolean): { row: HTMLDivElement; fillEl: HTMLSpanElement; valueEl: HTMLSpanElement } {
    const row = el('div', 'hud2p-row');
    const label = el('span', 'hud2p-label');
    label.textContent = kind === 'damage' ? 'Dmg:' : 'Ammo:';
    const bar = el('span', `hud2p-bar hud2p-bar-${kind}`);
    const fillEl = el('span', 'hud2p-bar-fill');
    bar.appendChild(fillEl);
    const valueEl = el('span', 'hud2p-value');
    row.append(label, bar);
    if (trailingValue) row.append(valueEl);
    return { row, fillEl, valueEl };
  }

  private buildPanel(className: string, label: string): PlayerPanel {
    const root = el('div', className);
    const title = el('div', 'hud2p-title');
    title.textContent = label;
    const { row: livesRow, valueEl: livesEl } = this.row('Lives:');
    const damage = this.bar('damage', false);
    const ammo = this.bar('ammo', true);
    root.append(title, livesRow, damage.row, ammo.row);
    return { root, livesEl, livesRow, damageFillEl: damage.fillEl, ammoFillEl: ammo.fillEl, ammoEl: ammo.valueEl };
  }

  private updatePanel(panel: PlayerPanel, tank: TankState | null, lives: number | null): void {
    if (!tank) {
      panel.root.style.visibility = 'hidden';
      return;
    }
    panel.root.style.visibility = 'visible';
    panel.livesRow.style.display = lives === null ? 'none' : 'flex'; // duel has no lives concept
    if (lives !== null) panel.livesEl.textContent = String(Math.max(0, lives));

    const shieldPct = Math.round((tank.shield / tank.maxShield) * 100);
    panel.damageFillEl.style.width = `${100 - shieldPct}%`;

    const ammo = Math.round(tank.ammo);
    panel.ammoEl.textContent = String(ammo);
    panel.ammoFillEl.style.width = `${(ammo / tank.maxAmmo) * 100}%`;
  }

  update(state: GameState): void {
    const active = state.player2 !== null;
    this.root.classList.toggle('visible', active);
    if (!active) return;

    this.updatePanel(this.left, state.player, state.mode === 'coop' ? state.lives : null);
    this.updatePanel(this.right, state.player2, state.mode === 'coop' ? state.lives2 : null);

    if (state.mode === 'duel') {
      this.centerEl.innerHTML =
        `<div class="hud2p-row">Kills: ${state.kills.player} - ${state.kills.player2}</div>` +
        `<div class="hud2p-row">First to ${DUEL_KILL_TARGET}</div>`;
    } else {
      this.centerEl.innerHTML =
        `<div class="hud2p-row">Score: ${state.score}</div>` +
        `<div class="hud2p-row">Level: ${state.level}</div>` +
        `<div class="hud2p-row">Flags: ${state.flagsCollected}/${FLAGS_PER_LEVEL}</div>`;
    }
  }
}
