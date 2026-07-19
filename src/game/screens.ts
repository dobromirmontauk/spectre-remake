// DOM overlay screens: main menu, tank setup, About/Help/Scores dialogs,
// the Esc "quit to menu" confirm, and the Game Over / high-score-initials
// card. Pure DOM + CSS — no three.js, no sim logic beyond calling the sim's
// own (pure) reset helpers.

import type { GameFlow } from './flow.ts';
import type { GameMode, GameState, Loadout } from '../sim/types.ts';
import { resetGameWithLoadout } from '../sim/simulation.ts';
import { loadHighScores, qualifiesForHighScore, recordHighScore } from './highscores.ts';
import {
  CUSTOM_AMMO_COST_PER_POINT,
  CUSTOM_SHIELDS_COST_PER_POINT,
  CUSTOM_SPEED_COST_PER_POINT,
  DEFAULT_LOADOUT,
  DUEL_KILL_TARGET,
  LOADOUT_AMMO_MAX,
  LOADOUT_AMMO_MIN,
  LOADOUT_PRESETS,
  LOADOUT_SHIELDS_MAX,
  LOADOUT_SHIELDS_MIN,
  LOADOUT_SPEED_MAX,
  LOADOUT_SPEED_MIN,
  POINT_BUDGET,
  type LoadoutPreset,
} from '../config/constants.ts';

export interface ScreensCallbacks {
  getFilled(): boolean;
  toggleFilled(): boolean;
  getMuted(): boolean;
  toggleMuted(): boolean;
  onAnyInteraction(): void; // resume/create AudioContext on first gesture
}

type DialogKind = 'about' | 'help' | 'scores' | null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

// Decorative art matching spectre_2.jpg: a yellow wireframe pyramid + cube
// and a red wireframe tank silhouette floating over dotted perspective
// ground lines. Hand-authored SVG (acceptable per plan) rather than a
// separate Three.js scene — it's static, so a vector drawing is simplest.
const DECOR_SVG = `
<svg viewBox="0 0 520 300" xmlns="http://www.w3.org/2000/svg" fill="none" stroke-linejoin="round">
  <g stroke="#666" stroke-width="1" stroke-dasharray="2 5">
    <line x1="260" y1="120" x2="20" y2="290" />
    <line x1="260" y1="120" x2="500" y2="290" />
    <line x1="260" y1="120" x2="60" y2="130" />
    <line x1="260" y1="120" x2="460" y2="130" />
    <line x1="260" y1="120" x2="150" y2="290" />
    <line x1="260" y1="120" x2="370" y2="290" />
  </g>
  <g stroke="#e8d24a" stroke-width="2">
    <polygon points="95,70 30,150 175,150" />
    <line x1="95" y1="70" x2="103" y2="152" />
  </g>
  <g stroke="#e8d24a" stroke-width="2">
    <polygon points="330,60 430,60 430,150 330,150" />
    <polygon points="358,40 458,40 458,130 430,150 430,60 358,60" />
    <line x1="330" y1="60" x2="358" y2="40" />
    <line x1="430" y1="60" x2="458" y2="40" />
    <line x1="330" y1="150" x2="358" y2="130" />
    <line x1="458" y1="40" x2="458" y2="130" />
    <line x1="358" y1="130" x2="458" y2="130" />
  </g>
  <g stroke="#d84a3a" stroke-width="2">
    <polygon points="90,205 260,190 320,215 300,245 150,255 70,235" />
    <line x1="150" y1="255" x2="260" y2="190" />
    <line x1="150" y1="255" x2="90" y2="205" />
    <line x1="300" y1="245" x2="320" y2="215" />
  </g>
</svg>`;

export class Screens {
  private flow: GameFlow;
  private state: GameState;
  private callbacks: ScreensCallbacks;

  private menuEl: HTMLDivElement;
  private modeSelectEl: HTMLDivElement;
  private tankSetupEl: HTMLDivElement;
  private dialogOverlayEl: HTMLDivElement;
  private dialogPanelEl: HTMLDivElement;
  private confirmQuitEl: HTMLDivElement;
  private gameOverEl: HTMLDivElement;

  private filledButton: HTMLButtonElement | null = null;
  private openDialog: DialogKind = null;

  private selectedMode: GameMode = 'solo';
  private selectedPresetId: LoadoutPreset['id'] | 'custom' = 'balanced';
  private customLoadout: Loadout = { speed: LOADOUT_SPEED_MIN, shields: LOADOUT_SHIELDS_MIN, ammo: LOADOUT_AMMO_MIN };
  // Player 2's loadout picker is preset-only (no custom sliders) — "keep it
  // simple" per the multiplayer plan; defaults to Balanced like P1.
  private selectedPresetId2: LoadoutPreset['id'] = 'balanced';

  private pendingScoreEntry: { score: number; level: number } | null = null;
  private lastPhase: string | null = null;

  constructor(root: HTMLElement, flow: GameFlow, state: GameState, callbacks: ScreensCallbacks) {
    this.flow = flow;
    this.state = state;
    this.callbacks = callbacks;

    this.menuEl = this.buildMenu();
    this.modeSelectEl = this.buildModeSelect();
    this.tankSetupEl = this.buildTankSetup();
    const { overlay, panel } = this.buildDialogShell();
    this.dialogOverlayEl = overlay;
    this.dialogPanelEl = panel;
    this.confirmQuitEl = this.buildConfirmQuit();
    this.gameOverEl = this.buildGameOver();

    root.append(this.menuEl, this.modeSelectEl, this.tankSetupEl, this.dialogOverlayEl, this.confirmQuitEl, this.gameOverEl);
  }

  // --- Menu ---

  private buildMenu(): HTMLDivElement {
    const wrap = el('div', 'screen screen-menu');

    const wordmark = el('div', 'spectre-wordmark');
    wordmark.innerHTML = 'SPECTRE<span class="tm">&trade;</span>';
    wrap.appendChild(wordmark);

    const decor = el('div', 'menu-decor');
    decor.innerHTML = DECOR_SVG;
    wrap.appendChild(decor);

    const buttons = el('div', 'menu-buttons');

    const playBtn = this.menuButton('Play', () => {
      this.callbacks.onAnyInteraction();
      this.flow.goToModeSelect();
    });
    buttons.appendChild(playBtn);

    const netPlayBtn = this.menuButton('Net Play', () => {});
    netPlayBtn.disabled = true;
    netPlayBtn.title = 'Coming soon';
    buttons.appendChild(netPlayBtn);

    buttons.appendChild(this.menuButton('Scores', () => this.showDialog('scores')));
    buttons.appendChild(this.menuButton('About', () => this.showDialog('about')));
    buttons.appendChild(this.menuButton('Help', () => this.showDialog('help')));

    this.filledButton = this.menuButton(this.filledLabel(), () => {
      const filled = this.callbacks.toggleFilled();
      this.filledButton!.textContent = this.filledLabel(filled);
    });
    buttons.appendChild(this.filledButton);

    buttons.appendChild(this.menuButton('Quit', () => this.handleQuit()));

    wrap.appendChild(buttons);

    const footer = el('div', 'menu-footer');
    footer.textContent = 'Fan-made browser replica — original ©1991 Peninsula Gameworks (Steve Newman & Sam Schillace)';
    wrap.appendChild(footer);

    const quitNote = el('div', 'menu-quit-note');
    quitNote.textContent = "Browsers won't let a page close its own tab — thanks for playing!";
    wrap.appendChild(quitNote);
    this.quitNoteEl = quitNote;

    return wrap;
  }

  // --- Mode select (Play -> here -> Tank Setup) ---

  private buildModeSelect(): HTMLDivElement {
    const wrap = el('div', 'screen screen-modeselect');

    const title = el('div', 'modeselect-title');
    title.textContent = 'SELECT MODE';
    wrap.appendChild(title);

    const buttons = el('div', 'modeselect-buttons');
    const modes: { mode: GameMode; label: string; blurb: string }[] = [
      { mode: 'solo', label: '1 Player', blurb: 'The original single-player campaign.' },
      { mode: 'coop', label: '2P Co-op', blurb: 'Share the arena, fight AI tanks together.' },
      { mode: 'duel', label: '2P Duel', blurb: `Player vs player — first to ${DUEL_KILL_TARGET} kills wins.` },
    ];
    for (const { mode, label, blurb } of modes) {
      const btn = el('button', 'menu-button modeselect-button');
      btn.type = 'button';
      const title2 = el('div', 'modeselect-button-label');
      title2.textContent = label;
      const desc = el('div', 'modeselect-button-blurb');
      desc.textContent = blurb;
      btn.append(title2, desc);
      btn.addEventListener('click', () => {
        this.callbacks.onAnyInteraction();
        this.selectedMode = mode;
        this.flow.goToTankSetup();
      });
      buttons.appendChild(btn);
    }
    wrap.appendChild(buttons);

    const backBtn = this.menuButton('Back', () => this.flow.goToMenu());
    backBtn.classList.add('modeselect-back');
    wrap.appendChild(backBtn);

    return wrap;
  }

  // Esc from tank setup returns to mode select (the screen immediately
  // before it in the Play flow), not all the way back to the main menu.
  backFromTankSetup(): void {
    this.flow.goToModeSelect();
  }

  private quitNoteEl!: HTMLDivElement;
  private quitNoteTimer: number | undefined;

  private filledLabel(filled = this.callbacks.getFilled()): string {
    return filled ? 'Filled' : 'Wireframe';
  }

  private menuButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = el('button', 'menu-button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      this.callbacks.onAnyInteraction();
      onClick();
    });
    return btn;
  }

  private handleQuit(): void {
    window.close();
    // window.close() silently no-ops for a tab the page didn't open itself
    // (which is virtually always true here) — there's no reliable way to
    // detect that failure, so just surface a charming explanation after a
    // beat in case we're still around to show it.
    window.clearTimeout(this.quitNoteTimer);
    this.quitNoteEl.classList.add('visible');
    this.quitNoteTimer = window.setTimeout(() => this.quitNoteEl.classList.remove('visible'), 3200);
  }

  // --- Tank setup ---

  private tankSetupPreview!: HTMLDivElement;
  private customSlidersEl!: HTMLDivElement;
  private sliderEls: Record<'speed' | 'shields' | 'ammo', HTMLInputElement> = {} as never;
  private sliderValueEls: Record<'speed' | 'shields' | 'ammo', HTMLSpanElement> = {} as never;
  private budgetEl!: HTMLDivElement;
  private presetButtons: HTMLButtonElement[] = [];
  private p2ColEl!: HTMLDivElement;
  private p2Preview!: HTMLDivElement;
  private presetButtons2: HTMLButtonElement[] = [];

  private buildTankSetup(): HTMLDivElement {
    const wrap = el('div', 'screen screen-tanksetup');

    const title = el('div', 'tanksetup-title');
    title.textContent = 'TANK SETUP';
    wrap.appendChild(title);

    const columns = el('div', 'tanksetup-columns');

    const p1Col = el('div', 'tanksetup-col');
    const p1ColTitle = el('div', 'tanksetup-col-title');
    p1ColTitle.textContent = 'Player 1';
    p1Col.appendChild(p1ColTitle);

    const presetRow = el('div', 'preset-row');
    for (const preset of LOADOUT_PRESETS) {
      const btn = el('button', 'preset-button');
      btn.type = 'button';
      btn.textContent = preset.name;
      btn.addEventListener('click', () => this.selectPreset(preset.id));
      presetRow.appendChild(btn);
      this.presetButtons.push(btn);
    }
    const customBtn = el('button', 'preset-button');
    customBtn.type = 'button';
    customBtn.textContent = 'Custom';
    customBtn.addEventListener('click', () => this.selectPreset('custom'));
    presetRow.appendChild(customBtn);
    this.presetButtons.push(customBtn);
    p1Col.appendChild(presetRow);

    this.tankSetupPreview = el('div', 'tanksetup-preview');
    p1Col.appendChild(this.tankSetupPreview);

    this.customSlidersEl = el('div', 'custom-sliders');
    (['speed', 'shields', 'ammo'] as const).forEach((stat) => {
      const row = el('label', 'slider-row');
      const capLabel = stat === 'speed' ? 'Speed' : stat === 'shields' ? 'Shields' : 'Ammo';
      const nameSpan = el('span', 'slider-name');
      nameSpan.textContent = capLabel;
      const input = el('input', 'slider-input');
      input.type = 'range';
      const [min, max] = this.statRange(stat);
      input.min = String(min);
      input.max = String(max);
      const valueSpan = el('span', 'slider-value');
      input.addEventListener('input', () => this.onSliderInput(stat, Number(input.value)));
      row.append(nameSpan, input, valueSpan);
      this.customSlidersEl.appendChild(row);
      this.sliderEls[stat] = input;
      this.sliderValueEls[stat] = valueSpan;
    });
    this.budgetEl = el('div', 'budget-remaining');
    this.customSlidersEl.appendChild(this.budgetEl);
    p1Col.appendChild(this.customSlidersEl);
    columns.appendChild(p1Col);

    // Player 2 column: 2P modes only, preset picker only (no custom sliders)
    // — "both default Balanced, click to change" keeps the second column
    // simple rather than duplicating the full custom-slider UI.
    this.p2ColEl = el('div', 'tanksetup-col tanksetup-col-p2');
    const p2ColTitle = el('div', 'tanksetup-col-title tanksetup-col-title-p2');
    p2ColTitle.textContent = 'Player 2';
    this.p2ColEl.appendChild(p2ColTitle);
    const presetRow2 = el('div', 'preset-row');
    for (const preset of LOADOUT_PRESETS) {
      const btn = el('button', 'preset-button');
      btn.type = 'button';
      btn.textContent = preset.name;
      btn.addEventListener('click', () => this.selectPreset2(preset.id));
      presetRow2.appendChild(btn);
      this.presetButtons2.push(btn);
    }
    this.p2ColEl.appendChild(presetRow2);
    this.p2Preview = el('div', 'tanksetup-preview');
    this.p2ColEl.appendChild(this.p2Preview);
    columns.appendChild(this.p2ColEl);

    wrap.appendChild(columns);

    const actionRow = el('div', 'tanksetup-actions');
    const startBtn = this.menuButton('Start', () => this.startGame());
    const backBtn = this.menuButton('Back', () => this.backFromTankSetup());
    actionRow.append(backBtn, startBtn);
    wrap.appendChild(actionRow);

    this.selectPreset('balanced');
    this.selectPreset2('balanced');
    return wrap;
  }

  private selectPreset2(id: LoadoutPreset['id']): void {
    this.selectedPresetId2 = id;
    for (const btn of this.presetButtons2) {
      btn.classList.toggle('selected', btn.textContent === this.presetLabelFor(id));
    }
    const preset = LOADOUT_PRESETS.find((p) => p.id === id) ?? DEFAULT_LOADOUT;
    this.p2Preview.textContent = `Speed ${preset.speed}  ·  Shields ${preset.shields}  ·  Ammo ${preset.ammo}`;
  }

  private loadout2(): Loadout {
    const preset = LOADOUT_PRESETS.find((p) => p.id === this.selectedPresetId2) ?? DEFAULT_LOADOUT;
    return { speed: preset.speed, shields: preset.shields, ammo: preset.ammo };
  }

  private statRange(stat: 'speed' | 'shields' | 'ammo'): [number, number] {
    if (stat === 'speed') return [LOADOUT_SPEED_MIN, LOADOUT_SPEED_MAX];
    if (stat === 'shields') return [LOADOUT_SHIELDS_MIN, LOADOUT_SHIELDS_MAX];
    return [LOADOUT_AMMO_MIN, LOADOUT_AMMO_MAX];
  }

  private statCostPerPoint(stat: 'speed' | 'shields' | 'ammo'): number {
    if (stat === 'speed') return CUSTOM_SPEED_COST_PER_POINT;
    if (stat === 'shields') return CUSTOM_SHIELDS_COST_PER_POINT;
    return CUSTOM_AMMO_COST_PER_POINT;
  }

  private customCost(loadout: Loadout): number {
    return (
      loadout.speed * CUSTOM_SPEED_COST_PER_POINT +
      loadout.shields * CUSTOM_SHIELDS_COST_PER_POINT +
      loadout.ammo * CUSTOM_AMMO_COST_PER_POINT
    );
  }

  private onSliderInput(stat: 'speed' | 'shields' | 'ammo', requested: number): void {
    const tentative = { ...this.customLoadout, [stat]: requested };
    const cost = this.customCost(tentative);
    if (cost > POINT_BUDGET) {
      // Snap back to the highest value for this stat that keeps the total
      // within budget, rather than rejecting the drag outright.
      const otherCost = cost - requested * this.statCostPerPoint(stat);
      const affordable = (POINT_BUDGET - otherCost) / this.statCostPerPoint(stat);
      const [min] = this.statRange(stat);
      tentative[stat] = Math.max(min, Math.floor(affordable));
      this.sliderEls[stat].value = String(tentative[stat]);
    }
    this.customLoadout = tentative;
    this.refreshSliderLabels();
  }

  private refreshSliderLabels(): void {
    this.sliderValueEls.speed.textContent = String(this.customLoadout.speed);
    this.sliderValueEls.shields.textContent = String(this.customLoadout.shields);
    this.sliderValueEls.ammo.textContent = String(this.customLoadout.ammo);
    const used = Math.round(this.customCost(this.customLoadout));
    this.budgetEl.textContent = `Points remaining: ${Math.max(0, POINT_BUDGET - used)} / ${POINT_BUDGET}`;
  }

  private selectPreset(id: LoadoutPreset['id'] | 'custom'): void {
    this.selectedPresetId = id;
    for (const btn of this.presetButtons) {
      btn.classList.toggle('selected', btn.textContent === this.presetLabelFor(id));
    }
    if (id === 'custom') {
      this.customSlidersEl.classList.add('visible');
      this.sliderEls.speed.value = String(this.customLoadout.speed);
      this.sliderEls.shields.value = String(this.customLoadout.shields);
      this.sliderEls.ammo.value = String(this.customLoadout.ammo);
      this.refreshSliderLabels();
      this.tankSetupPreview.textContent = 'Allocate your points below.';
    } else {
      this.customSlidersEl.classList.remove('visible');
      const preset = LOADOUT_PRESETS.find((p) => p.id === id) ?? DEFAULT_LOADOUT;
      this.tankSetupPreview.textContent = `Speed ${preset.speed}  ·  Shields ${preset.shields}  ·  Ammo ${preset.ammo}`;
    }
  }

  private presetLabelFor(id: LoadoutPreset['id'] | 'custom'): string {
    if (id === 'custom') return 'Custom';
    return LOADOUT_PRESETS.find((p) => p.id === id)?.name ?? '';
  }

  private currentLoadout(): Loadout {
    if (this.selectedPresetId === 'custom') return { ...this.customLoadout };
    const preset = LOADOUT_PRESETS.find((p) => p.id === this.selectedPresetId) ?? DEFAULT_LOADOUT;
    return { speed: preset.speed, shields: preset.shields, ammo: preset.ammo };
  }

  private startGame(): void {
    const opts = this.selectedMode === 'solo' ? undefined : { mode: this.selectedMode, loadout2: this.loadout2() };
    resetGameWithLoadout(this.state, this.currentLoadout(), 1, opts);
    this.flow.beginRun();
  }

  // --- About/Help/Scores dialogs ---

  private buildDialogShell(): { overlay: HTMLDivElement; panel: HTMLDivElement } {
    const overlay = el('div', 'dialog-overlay');
    const panel = el('div', 'dialog-panel');
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeDialog();
    });
    return { overlay, panel };
  }

  private showDialog(kind: Exclude<DialogKind, null>): void {
    this.openDialog = kind;
    this.dialogPanelEl.innerHTML = '';

    const closeBtn = el('button', 'dialog-close');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.closeDialog());
    this.dialogPanelEl.appendChild(closeBtn);

    if (kind === 'about') {
      const body = el('div', 'dialog-body');
      body.innerHTML = `
        <h2>About</h2>
        <p>A browser replica of <em>Spectre</em> (1991), built with Three.js as a fan tribute.</p>
        <p>Original game design &amp; programming: Steve Newman and Sam Schillace, Peninsula Gameworks.</p>
        <p>Not affiliated with or endorsed by the original creators or publisher.</p>
      `;
      this.dialogPanelEl.appendChild(body);
    } else if (kind === 'help') {
      const body = el('div', 'dialog-body');
      body.innerHTML = `
        <h2>Controls</h2>
        <h3>Player 1</h3>
        <ul class="controls-list">
          <li><span>Arrow keys</span><span>Steer &amp; throttle</span></li>
          <li><span>Space</span><span>Fire cannon</span></li>
          <li><span>Alt / G</span><span>Grenade (level 10+)</span></li>
        </ul>
        <h3>Player 2 (2P Co-op / Duel)</h3>
        <ul class="controls-list">
          <li><span>W A S D</span><span>Steer &amp; throttle</span></li>
          <li><span>F</span><span>Fire cannon</span></li>
          <li><span>Q</span><span>Grenade (co-op, level 10+)</span></li>
        </ul>
        <h3>General</h3>
        <ul class="controls-list">
          <li><span>Tab</span><span>Cycle camera view (1P only)</span></li>
          <li><span>P</span><span>Pause</span></li>
          <li><span>M</span><span>Toggle sound</span></li>
          <li><span>Esc</span><span>Menu</span></li>
          <li><span>Enter</span><span>Confirm</span></li>
        </ul>
      `;
      this.dialogPanelEl.appendChild(body);
    } else {
      const body = el('div', 'dialog-body');
      const scores = loadHighScores();
      const rows = scores
        .map((s, i) => `<tr><td>${i + 1}</td><td>${s.name}</td><td>${s.score}</td><td>${s.level}</td></tr>`)
        .join('');
      body.innerHTML = `
        <h2>High Scores</h2>
        ${
          scores.length
            ? `<table class="scores-table"><thead><tr><th>#</th><th>Name</th><th>Score</th><th>Level</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<p>No scores yet — be the first!</p>'
        }
      `;
      this.dialogPanelEl.appendChild(body);
    }

    this.dialogOverlayEl.classList.add('visible');
  }

  closeDialog(): void {
    this.openDialog = null;
    this.dialogOverlayEl.classList.remove('visible');
  }

  // --- Esc quit-confirm ---

  private buildConfirmQuit(): HTMLDivElement {
    const overlay = el('div', 'confirm-quit-overlay');
    const panel = el('div', 'confirm-quit-panel');
    const msg = el('div', 'confirm-quit-message');
    msg.textContent = 'Return to main menu? Your current run will end.';
    panel.appendChild(msg);
    const row = el('div', 'confirm-quit-actions');
    const yesBtn = this.menuButton('Yes', () => this.confirmQuitYes());
    const noBtn = this.menuButton('No', () => this.flow.cancelQuitToMenu());
    row.append(noBtn, yesBtn);
    panel.appendChild(row);
    overlay.appendChild(panel);
    return overlay;
  }

  private confirmQuitYes(): void {
    this.maybeRecordScoreThenGoToMenu(this.state.score, this.state.level);
  }

  // --- Game Over card + high-score initials entry ---

  private gameOverTitleEl!: HTMLDivElement;
  private gameOverStatsEl!: HTMLDivElement;
  private gameOverHintEl!: HTMLDivElement;
  private initialsFormEl!: HTMLDivElement;
  private initialsInputEl!: HTMLInputElement;

  private buildGameOver(): HTMLDivElement {
    const wrap = el('div', 'gameover-card');
    this.gameOverTitleEl = el('div', 'gameover-title');
    this.gameOverTitleEl.textContent = 'GAME OVER';
    this.gameOverStatsEl = el('div', 'gameover-stats');
    this.gameOverHintEl = el('div', 'gameover-hint');
    this.gameOverHintEl.textContent = 'Press Enter to return to menu';

    this.initialsFormEl = el('div', 'initials-form');
    this.initialsFormEl.innerHTML = '<div class="initials-label">New high score! Enter your initials:</div>';
    this.initialsInputEl = el('input', 'initials-input');
    this.initialsInputEl.maxLength = 3;
    this.initialsInputEl.autocapitalize = 'characters';
    this.initialsFormEl.appendChild(this.initialsInputEl);
    const submitBtn = this.menuButton('Submit', () => this.submitInitials());
    this.initialsFormEl.appendChild(submitBtn);

    wrap.append(this.gameOverTitleEl, this.gameOverStatsEl, this.initialsFormEl, this.gameOverHintEl);
    return wrap;
  }

  // Called by app.ts the moment a GameOver SimEvent is seen (exactly once
  // per run, since the event only fires the tick lives hit 0).
  notifyGameOver(score: number, level: number): void {
    if (qualifiesForHighScore(score)) {
      this.pendingScoreEntry = { score, level };
    }
  }

  private submitInitials(): void {
    if (!this.pendingScoreEntry) return;
    recordHighScore(this.initialsInputEl.value, this.pendingScoreEntry.score, this.pendingScoreEntry.level);
    this.pendingScoreEntry = null;
    this.initialsInputEl.value = '';
  }

  private maybeRecordScoreThenGoToMenu(score: number, level: number): void {
    // Duel is a match, not a scored run — never prompt for high-score initials.
    if (this.state.mode !== 'duel' && qualifiesForHighScore(score) && !this.pendingScoreEntry) {
      // Manual Esc-quit mid-run: no dedicated initials screen exists outside
      // Game Over, so prompt inline via a plain browser prompt rather than
      // building a second parallel UI for the same one-time action.
      const name = window.prompt('New high score! Enter your initials (3 letters):', '');
      recordHighScore(name ?? '', score, level);
    }
    this.flow.goToMenu();
  }

  // Enter key on the Game Over card: submits pending initials if the entry
  // form is showing, otherwise returns straight to the menu. Called from
  // app.ts's edge-key handler.
  handleGameOverEnter(): void {
    if (this.pendingScoreEntry) {
      this.submitInitials();
      return;
    }
    this.flow.goToMenu();
  }

  get isDialogOpen(): boolean {
    return this.openDialog !== null;
  }

  // --- Per-frame visibility sync ---

  update(): void {
    const phase = this.flow.phase;
    if (phase !== this.lastPhase) {
      if (phase !== 'GameOver') this.pendingScoreEntry = null;
      this.lastPhase = phase;
    }

    if (this.flow.showMenu && this.filledButton) this.filledButton.textContent = this.filledLabel();

    this.menuEl.classList.toggle('visible', this.flow.showMenu);
    this.modeSelectEl.classList.toggle('visible', this.flow.showModeSelect);
    this.tankSetupEl.classList.toggle('visible', this.flow.showTankSetup);
    if (this.flow.showTankSetup) this.p2ColEl.classList.toggle('visible', this.selectedMode !== 'solo');
    this.confirmQuitEl.classList.toggle('visible', this.flow.showConfirmQuit);

    const showGameOver = this.flow.showGameOver;
    this.gameOverEl.classList.toggle('visible', showGameOver);
    if (showGameOver) {
      if (this.state.mode === 'duel') {
        // Duel ends in a winner screen, not a scored Game Over — no initials
        // prompt, no high-score qualification (see maybeRecordScoreThenGoToMenu).
        const winner = this.state.players.find((p) => p.id === this.state.winner);
        const winnerLabel = winner ? `PLAYER ${winner.slot + 1}` : '???';
        this.gameOverTitleEl.textContent = `${winnerLabel} WINS!`;
        const tally = this.state.players.map((p) => `P${p.slot + 1}: ${p.kills}`).join(' - ');
        this.gameOverStatsEl.innerHTML = `<div>Kills: ${tally}</div>`;
        this.initialsFormEl.classList.remove('visible');
        this.gameOverHintEl.style.visibility = 'visible';
        this.gameOverHintEl.textContent = 'Press Enter to return to menu';
      } else {
        this.gameOverTitleEl.textContent = 'GAME OVER';
        this.gameOverStatsEl.innerHTML = `<div>Score: ${this.state.score}</div><div>Level: ${this.state.level}</div>`;
        const showInitials = this.pendingScoreEntry !== null;
        this.initialsFormEl.classList.toggle('visible', showInitials);
        this.gameOverHintEl.style.visibility = showInitials ? 'hidden' : 'visible';
        this.gameOverHintEl.textContent = 'Press Enter to return to menu';
        if (showInitials && document.activeElement !== this.initialsInputEl) this.initialsInputEl.focus();
      }
    }
  }
}
