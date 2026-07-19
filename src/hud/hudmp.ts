// Compact per-player HUD for 2-8 player co-op/duel (generalized from the old
// 2-player-only hud2p.ts): a lives/damage/ammo panel per player (slot 0
// pinned left, slot 1 pinned right, any further slots fill a center-flanking
// row — only reachable once net play, M2+, allows more than 2 local
// players), plus a shared center block (Score/Level/Flags in co-op, kill
// tally in duel). Built as its own DOM tree (appended to #stage by
// game/app.ts) rather than touching the solo #hud-top markup, so 1-player
// behavior/layout is completely untouched; app.ts shows this HUD instead of
// the solo Hud whenever state.players.length > 1.
//
// >=5 players collapses each panel to a single dense row (name + lives + hp%
// + ammo) instead of the fuller lives/damage-bar/ammo-bar block — the fuller
// layout doesn't fit 5+ panels across one HUD strip.

import type { GameState, PlayerState } from '../sim/types.ts';
import { DUEL_KILL_TARGET, FLAGS_PER_LEVEL } from '../config/constants.ts';

const DENSE_THRESHOLD = 5;

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
  denseEl: HTMLDivElement;
}

export class HudMp {
  private root: HTMLDivElement;
  private panelsRow: HTMLDivElement;
  private centerEl: HTMLDivElement;
  private panels: PlayerPanel[] = [];

  constructor(stage: HTMLElement) {
    this.root = el('div', 'hudmp-top');
    this.panelsRow = el('div', 'hudmp-panels');
    this.centerEl = el('div', 'hudmp-center');
    this.root.append(this.panelsRow, this.centerEl);
    stage.appendChild(this.root);
  }

  private row(labelText: string): { row: HTMLDivElement; valueEl: HTMLSpanElement } {
    const row = el('div', 'hudmp-row');
    const label = el('span', 'hudmp-label');
    label.textContent = labelText;
    const valueEl = el('span', 'hudmp-value');
    row.append(label, valueEl);
    return { row, valueEl };
  }

  private bar(kind: 'damage' | 'ammo', trailingValue: boolean): { row: HTMLDivElement; fillEl: HTMLSpanElement; valueEl: HTMLSpanElement } {
    const row = el('div', 'hudmp-row');
    const label = el('span', 'hudmp-label');
    label.textContent = kind === 'damage' ? 'Dmg:' : 'Ammo:';
    const bar = el('span', `hudmp-bar hudmp-bar-${kind}`);
    const fillEl = el('span', 'hudmp-bar-fill');
    bar.appendChild(fillEl);
    const valueEl = el('span', 'hudmp-value');
    row.append(label, bar);
    if (trailingValue) row.append(valueEl);
    return { row, fillEl, valueEl };
  }

  private buildPanel(slot: number): PlayerPanel {
    const side = slot === 0 ? 'hudmp-left' : slot === 1 ? 'hudmp-right' : 'hudmp-mid';
    const root = el('div', `hudmp-panel ${side}`);
    const title = el('div', 'hudmp-title');
    title.textContent = `P${slot + 1}`;
    const { row: livesRow, valueEl: livesEl } = this.row('Lives:');
    const damage = this.bar('damage', false);
    const ammo = this.bar('ammo', true);
    const denseEl = el('div', 'hudmp-dense');
    root.append(title, livesRow, damage.row, ammo.row, denseEl);
    return { root, livesEl, livesRow, damageFillEl: damage.fillEl, ammoFillEl: ammo.fillEl, ammoEl: ammo.valueEl, denseEl };
  }

  private ensurePanels(count: number): void {
    while (this.panels.length < count) {
      const panel = this.buildPanel(this.panels.length);
      this.panels.push(panel);
      this.panelsRow.appendChild(panel.root);
    }
    for (let i = 0; i < this.panels.length; i++) {
      this.panels[i]!.root.style.display = i < count ? '' : 'none';
    }
  }

  private updatePanel(panel: PlayerPanel, player: PlayerState, dense: boolean, showLives: boolean): void {
    panel.root.classList.toggle('dense', dense);
    const shieldPct = Math.round((player.shield / player.maxShield) * 100);
    const ammo = Math.round(player.ammo);

    if (dense) {
      const livesText = showLives ? ` · Lives ${Math.max(0, player.lives)}` : '';
      panel.denseEl.textContent = `P${player.slot + 1}${livesText} · HP ${Math.max(0, shieldPct)}% · Ammo ${ammo}`;
      return;
    }

    panel.livesRow.style.display = showLives ? 'flex' : 'none';
    if (showLives) panel.livesEl.textContent = String(Math.max(0, player.lives));
    panel.damageFillEl.style.width = `${100 - shieldPct}%`;
    panel.ammoEl.textContent = String(ammo);
    panel.ammoFillEl.style.width = `${(ammo / player.maxAmmo) * 100}%`;
  }

  update(state: GameState): void {
    const players = state.players;
    const active = players.length > 1;
    this.root.classList.toggle('visible', active);
    if (!active) return;

    const dense = players.length >= DENSE_THRESHOLD;
    this.root.classList.toggle('hudmp-dense-mode', dense);
    this.ensurePanels(players.length);

    for (const player of players) {
      const panel = this.panels[player.slot];
      if (panel) this.updatePanel(panel, player, dense, state.mode === 'coop');
    }

    if (state.mode === 'duel') {
      const tally = players.map((p) => `P${p.slot + 1}: ${p.kills}`).join(' · ');
      this.centerEl.innerHTML =
        `<div class="hudmp-row">${tally}</div>` + `<div class="hudmp-row">First to ${DUEL_KILL_TARGET}</div>`;
    } else {
      this.centerEl.innerHTML =
        `<div class="hudmp-row">Score: ${state.score}</div>` +
        `<div class="hudmp-row">Level: ${state.level}</div>` +
        `<div class="hudmp-row">Flags: ${state.flagsCollected}/${FLAGS_PER_LEVEL}</div>`;
    }
  }
}
