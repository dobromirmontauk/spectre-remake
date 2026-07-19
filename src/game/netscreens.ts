// DOM overlay screens for net play: NetMenu (name entry + host/join) and
// NetLobby (room code, live roster, per-player loadout pick, host-only mode
// pick + Start). Pure DOM + CSS, same pattern as game/screens.ts, kept in
// its own module since it owns transport/lobby lifecycle that screens.ts
// has no business knowing about. sim/ is never touched here — the only sim
// import is the plain `Loadout`/`GameMode` types.

import type { GameFlow } from './flow.ts';
import type { GameMode, Loadout } from '../sim/types.ts';
import { LOADOUT_PRESETS, NET_INPUT_DELAY_TICKS, NET_NAME_STORAGE_KEY } from '../config/constants.ts';
import { PLAYER_TANK_COLOR_SLOTS } from '../config/palette.ts';
import { createTransport, transportLabel } from '../net/createTransport.ts';
import { NetLobby, type JoinDebugOverride, type LobbyError, type LobbyErrorReason } from '../net/lobby.ts';
import { generateRoomCode, normalizeRoomCode } from '../net/roomcode.ts';
import type { NetTransport } from '../net/transport.ts';
import type { RosterEntry, StartMessage } from '../net/protocol.ts';

export interface MatchStartInfo {
  transport: NetTransport;
  roster: RosterEntry[];
  mode: GameMode;
  level: number;
  inputDelay: number;
  selfPeerId: string;
}

export interface NetScreensCallbacks {
  onAnyInteraction(): void;
  // Fires on every peer (host included) the instant a match begins — see
  // net/lobby.ts NetLobby.startMatch()/onStart(). app.ts owns turning this
  // into a NetSession + resetGameWithRoster + flow.beginRun() (M3).
  onMatchStart(info: MatchStartInfo): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function loadStoredName(): string {
  try {
    return localStorage.getItem(NET_NAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeName(name: string): void {
  try {
    localStorage.setItem(NET_NAME_STORAGE_KEY, name);
  } catch {
    // Storage unavailable (private browsing, quota) — not worth surfacing.
  }
}

export class NetScreens {
  private readonly flow: GameFlow;
  private readonly callbacks: NetScreensCallbacks;

  private readonly netMenuEl: HTMLDivElement;
  private readonly netLobbyEl: HTMLDivElement;
  private readonly dialogOverlayEl: HTMLDivElement;
  private readonly dialogTitleEl: HTMLDivElement;
  private readonly dialogMessageEl: HTMLDivElement;
  private dialogOnClose: (() => void) | null = null;

  // --- M3: leave-match confirm (Esc mid-match) ---
  private readonly leaveConfirmEl: HTMLDivElement;
  private showLeaveConfirmFlag = false;
  private onLeaveConfirmed: (() => void) | null = null;

  private readonly nameInput: HTMLInputElement;
  private readonly statusEl: HTMLDivElement;

  private readonly hostCodeRow: HTMLDivElement;
  private readonly hostCodeEl: HTMLSpanElement;
  private readonly joinerCodeRow: HTMLDivElement;
  private readonly joinerCodeEl: HTMLSpanElement;
  private readonly rosterListEl: HTMLDivElement;
  private readonly modeButtonsRowEl: HTMLDivElement;
  private readonly modeButtons: HTMLButtonElement[] = [];
  private readonly modeLabelEl: HTMLDivElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly waitingLabelEl: HTMLDivElement;

  private lobby: NetLobby | null = null;
  private unsubChange: (() => void) | null = null;
  private unsubError: (() => void) | null = null;
  private unsubStart: (() => void) | null = null;
  private sessionToken = 0;

  constructor(root: HTMLElement, flow: GameFlow, callbacks: NetScreensCallbacks) {
    this.flow = flow;
    this.callbacks = callbacks;

    const menu = this.buildNetMenu();
    this.netMenuEl = menu.wrap;
    this.nameInput = menu.nameInput;
    this.statusEl = menu.statusEl;

    const lobbyScreen = this.buildNetLobby();
    this.netLobbyEl = lobbyScreen.wrap;
    this.hostCodeRow = lobbyScreen.hostCodeRow;
    this.hostCodeEl = lobbyScreen.hostCodeEl;
    this.joinerCodeRow = lobbyScreen.joinerCodeRow;
    this.joinerCodeEl = lobbyScreen.joinerCodeEl;
    this.rosterListEl = lobbyScreen.rosterListEl;
    this.modeButtonsRowEl = lobbyScreen.modeButtonsRowEl;
    this.modeButtons = lobbyScreen.modeButtons;
    this.modeLabelEl = lobbyScreen.modeLabelEl;
    this.startBtn = lobbyScreen.startBtn;
    this.waitingLabelEl = lobbyScreen.waitingLabelEl;

    const dialog = this.buildDialog();
    this.dialogOverlayEl = dialog.overlay;
    this.dialogTitleEl = dialog.title;
    this.dialogMessageEl = dialog.message;

    this.leaveConfirmEl = this.buildLeaveConfirm();

    this.nameInput.value = loadStoredName();

    root.append(this.netMenuEl, this.netLobbyEl, this.dialogOverlayEl, this.leaveConfirmEl);
  }

  // --- Per-frame visibility sync (mirrors game/screens.ts Screens.update) ---

  update(): void {
    this.netMenuEl.classList.toggle('visible', this.flow.showNetMenu);
    this.netLobbyEl.classList.toggle('visible', this.flow.showNetLobby);
    this.leaveConfirmEl.classList.toggle('visible', this.showLeaveConfirmFlag);
  }

  get isDialogOpen(): boolean {
    return this.dialogOverlayEl.classList.contains('visible');
  }

  get isLeaveConfirmOpen(): boolean {
    return this.showLeaveConfirmFlag;
  }

  // Esc while on a net screen — Back-button-equivalent. Returns true if it
  // was handled (caller's Escape chain should stop there).
  handleEscape(): boolean {
    if (this.isDialogOpen) {
      this.closeDialog();
      return true;
    }
    if (this.showLeaveConfirmFlag) {
      this.hideLeaveConfirm();
      return true;
    }
    if (this.flow.showNetLobby) {
      this.backFromLobby();
      return true;
    }
    if (this.flow.showNetMenu) {
      this.sessionToken++; // invalidate any in-flight host()/join()
      this.flow.goToMenu();
      return true;
    }
    return false;
  }

  // --- M3: leave-match confirm (Esc mid-match) ---

  private buildLeaveConfirm(): HTMLDivElement {
    // Reuses screens.ts's confirm-quit-* CSS classes verbatim (generic
    // modal-confirm styling, not scoped to that module) rather than
    // duplicating the look in a new stylesheet block.
    const overlay = el('div', 'confirm-quit-overlay');
    const panel = el('div', 'confirm-quit-panel');
    const msg = el('div', 'confirm-quit-message');
    msg.textContent = 'Leave the match? It will end for everyone.';
    panel.appendChild(msg);
    const row = el('div', 'confirm-quit-actions');
    const yesBtn = this.menuButton('Yes', () => {
      const cb = this.onLeaveConfirmed;
      this.hideLeaveConfirm();
      cb?.();
    });
    const noBtn = this.menuButton('No', () => this.hideLeaveConfirm());
    row.append(noBtn, yesBtn);
    panel.appendChild(row);
    overlay.appendChild(panel);
    return overlay;
  }

  // Shows the "Leave match?" confirm; `onConfirm` runs if the player picks
  // Yes (app.ts wires this to net-session teardown — see game/app.ts).
  requestLeaveConfirm(onConfirm: () => void): void {
    this.onLeaveConfirmed = onConfirm;
    this.showLeaveConfirmFlag = true;
  }

  hideLeaveConfirm(): void {
    this.showLeaveConfirmFlag = false;
    this.onLeaveConfirmed = null;
  }

  // --- Debug hooks (window.__game.net — see game/debug.ts) ---

  debugHost(name?: string): Promise<void> {
    const finalName = name ?? this.nameInput.value.trim() ?? 'Player';
    return this.doHost(finalName || 'Player');
  }

  debugJoin(code: string, name?: string, debugOverride?: JoinDebugOverride): Promise<void> {
    const finalName = name ?? this.nameInput.value.trim() ?? 'Player';
    return this.doJoin(code, finalName || 'Player', debugOverride);
  }

  debugRoomCode(): string | null {
    return this.lobby?.roomCode ?? null;
  }

  debugRoster(): RosterEntry[] {
    return this.lobby?.currentRoster ?? [];
  }

  debugLeave(): void {
    this.backFromLobby();
  }

  // Host-only convenience for Playwright verification — same path as
  // clicking the lobby's Start button.
  debugStartMatch(): void {
    this.onStartClicked();
  }

  // --- NetMenu screen ---

  private buildNetMenu(): {
    wrap: HTMLDivElement;
    nameInput: HTMLInputElement;
    codeInput: HTMLInputElement;
    statusEl: HTMLDivElement;
  } {
    const wrap = el('div', 'screen screen-netmenu');

    const title = el('div', 'netmenu-title');
    title.textContent = 'NET PLAY';
    wrap.appendChild(title);

    const transportHint = el('div', 'netmenu-transport-hint');
    transportHint.textContent = transportLabel();
    wrap.appendChild(transportHint);

    const nameRow = el('label', 'netmenu-name-row');
    const nameLabel = el('span', 'netmenu-name-label');
    nameLabel.textContent = 'Name';
    const nameInput = el('input', 'netmenu-name-input');
    nameInput.type = 'text';
    nameInput.maxLength = 16;
    nameInput.placeholder = 'Player';
    nameInput.addEventListener('input', () => storeName(nameInput.value));
    nameRow.append(nameLabel, nameInput);
    wrap.appendChild(nameRow);

    const actions = el('div', 'netmenu-actions');

    const hostBtn = this.menuButton('Host Game', () => {
      void this.doHost(this.currentName());
    });
    actions.appendChild(hostBtn);

    const joinRow = el('div', 'netmenu-join-row');
    const codeInput = el('input', 'netmenu-code-input');
    codeInput.type = 'text';
    codeInput.maxLength = 5;
    codeInput.placeholder = 'ROOM CODE';
    codeInput.autocapitalize = 'characters';
    const joinBtn = this.menuButton('Join Game', () => {
      void this.doJoin(codeInput.value, this.currentName());
    });
    joinRow.append(codeInput, joinBtn);
    actions.appendChild(joinRow);

    wrap.appendChild(actions);

    const statusEl = el('div', 'netmenu-status');
    wrap.appendChild(statusEl);

    const backBtn = this.menuButton('Back', () => this.flow.goToMenu());
    backBtn.classList.add('netmenu-back');
    wrap.appendChild(backBtn);

    return { wrap, nameInput, codeInput, statusEl };
  }

  private currentName(): string {
    return this.nameInput.value.trim() || 'Player';
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  // --- NetLobby screen ---

  private buildNetLobby(): {
    wrap: HTMLDivElement;
    hostCodeRow: HTMLDivElement;
    hostCodeEl: HTMLSpanElement;
    joinerCodeRow: HTMLDivElement;
    joinerCodeEl: HTMLSpanElement;
    rosterListEl: HTMLDivElement;
    modeButtonsRowEl: HTMLDivElement;
    modeButtons: HTMLButtonElement[];
    modeLabelEl: HTMLDivElement;
    startBtn: HTMLButtonElement;
    waitingLabelEl: HTMLDivElement;
  } {
    const wrap = el('div', 'screen screen-netlobby');

    const title = el('div', 'netlobby-title');
    title.textContent = 'LOBBY';
    wrap.appendChild(title);

    const transportHint = el('div', 'netmenu-transport-hint');
    transportHint.textContent = transportLabel();
    wrap.appendChild(transportHint);

    const hostCodeRow = el('div', 'netlobby-code-row netlobby-code-row-host');
    const hostCodeEl = el('span', 'netlobby-code');
    const copyBtn = this.menuButton('Copy', () => {
      void this.copyRoomCode();
    });
    copyBtn.classList.add('netlobby-copy');
    hostCodeRow.append(hostCodeEl, copyBtn);
    wrap.appendChild(hostCodeRow);

    const joinerCodeRow = el('div', 'netlobby-code-row netlobby-code-row-joiner');
    const joinerPrefix = el('span');
    joinerPrefix.textContent = 'Room ';
    const joinerCodeEl = el('span', 'netlobby-code');
    joinerCodeRow.append(joinerPrefix, joinerCodeEl);
    wrap.appendChild(joinerCodeRow);

    const rosterListEl = el('div', 'netlobby-roster');
    wrap.appendChild(rosterListEl);

    const modeRow = el('div', 'netlobby-mode-row');
    const modeButtonsRowEl = el('div', 'netlobby-mode-buttons');
    const modeButtons: HTMLButtonElement[] = [];
    const modeOptions: { mode: GameMode; label: string }[] = [
      { mode: 'coop', label: 'Net Co-op' },
      { mode: 'duel', label: 'Net Duel' },
    ];
    for (const { mode, label } of modeOptions) {
      const btn = el('button', 'preset-button netlobby-mode-button');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.mode = mode;
      btn.addEventListener('click', () => {
        this.callbacks.onAnyInteraction();
        this.lobby?.setMode(mode);
      });
      modeButtonsRowEl.appendChild(btn);
      modeButtons.push(btn);
    }
    modeRow.appendChild(modeButtonsRowEl);
    const modeLabelEl = el('div', 'netlobby-mode-label');
    modeRow.appendChild(modeLabelEl);
    wrap.appendChild(modeRow);

    const actionsRow = el('div', 'netlobby-actions');
    const backBtn = this.menuButton('Back', () => this.backFromLobby());
    const startBtn = this.menuButton('Start', () => this.onStartClicked());
    startBtn.classList.add('netlobby-start');
    actionsRow.append(backBtn, startBtn);
    wrap.appendChild(actionsRow);

    const waitingLabelEl = el('div', 'netlobby-waiting');
    waitingLabelEl.textContent = 'Waiting for the host to start…';
    wrap.appendChild(waitingLabelEl);

    return {
      wrap,
      hostCodeRow,
      hostCodeEl,
      joinerCodeRow,
      joinerCodeEl,
      rosterListEl,
      modeButtonsRowEl,
      modeButtons,
      modeLabelEl,
      startBtn,
      waitingLabelEl,
    };
  }

  private modeForButton(btn: HTMLButtonElement): GameMode {
    return (btn.dataset.mode as GameMode | undefined) ?? 'coop';
  }

  private buildRosterRow(entry: RosterEntry, lobby: NetLobby): HTMLDivElement {
    const row = el('div', 'netlobby-row');

    const colors = PLAYER_TANK_COLOR_SLOTS[entry.slot] ?? PLAYER_TANK_COLOR_SLOTS[PLAYER_TANK_COLOR_SLOTS.length - 1]!;
    const chip = el('span', 'netlobby-chip');
    chip.style.background = hexColor(colors.top);
    row.appendChild(chip);

    const isSelf = entry.peerId === lobby.selfId;
    const isEntryHost = entry.peerId === lobby.hostPeerId;
    const nameEl = el('span', 'netlobby-name');
    nameEl.textContent = `${entry.name}${isSelf ? ' (you)' : ''}${isEntryHost ? ' — HOST' : ''}`;
    row.appendChild(nameEl);

    const presetRow = el('div', 'netlobby-preset-row');
    for (const preset of LOADOUT_PRESETS) {
      const btn = el('button', 'preset-button netlobby-preset-button');
      btn.type = 'button';
      btn.textContent = preset.name;
      const matches = entry.loadout.speed === preset.speed && entry.loadout.shields === preset.shields && entry.loadout.ammo === preset.ammo;
      btn.classList.toggle('selected', matches);
      if (isSelf) {
        btn.addEventListener('click', () => {
          this.callbacks.onAnyInteraction();
          const loadout: Loadout = { speed: preset.speed, shields: preset.shields, ammo: preset.ammo };
          lobby.pickLoadout(loadout);
        });
      } else {
        btn.disabled = true;
      }
      presetRow.appendChild(btn);
    }
    row.appendChild(presetRow);

    return row;
  }

  private renderLobby(): void {
    const lobby = this.lobby;
    if (!lobby) return;
    const roster = lobby.currentRoster;
    const isHost = lobby.isHost;

    this.hostCodeRow.classList.toggle('visible', isHost);
    this.joinerCodeRow.classList.toggle('visible', !isHost);
    if (isHost) this.hostCodeEl.textContent = lobby.roomCode ?? '';
    else this.joinerCodeEl.textContent = lobby.roomCode ?? '';

    this.rosterListEl.innerHTML = '';
    for (const entry of roster) this.rosterListEl.appendChild(this.buildRosterRow(entry, lobby));

    this.modeButtonsRowEl.classList.toggle('visible', isHost);
    this.modeLabelEl.classList.toggle('visible', !isHost);
    this.modeLabelEl.textContent = lobby.currentMode === 'duel' ? 'Mode: Net Duel' : 'Mode: Net Co-op';
    for (const btn of this.modeButtons) {
      btn.disabled = !isHost;
      btn.classList.toggle('selected', this.modeForButton(btn) === lobby.currentMode);
    }

    this.startBtn.classList.toggle('visible', isHost);
    this.startBtn.disabled = roster.length < 2;
    this.waitingLabelEl.classList.toggle('visible', !isHost);
  }

  private async copyRoomCode(): Promise<void> {
    const code = this.lobby?.roomCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard API unavailable (permissions, non-secure context, headless
      // test env) — the code is already big on screen, so just no-op.
    }
  }

  private onStartClicked(): void {
    if (!this.lobby?.isHost) return;
    if (this.lobby.currentRoster.length < 2) return;
    this.lobby.startMatch(1, NET_INPUT_DELAY_TICKS);
  }

  // --- Match lifecycle (M3) ---

  // Called by app.ts when a net match ends normally (GameOver -> Enter) —
  // the room/transport stay alive and the host can Start another (state is
  // fully rebuilt each match, so this is safe — see plan §3.6).
  returnToLobbyAfterMatch(): void {
    this.lobby?.markMatchEnded();
    this.renderLobby();
  }

  // Info dialog for a match that ended abnormally (peer left, desync) — v1
  // "simple" handling per the plan (the full grace/drop protocol is M5):
  // whoever sees this ends up back at NetMenu via `onAcknowledge`.
  showMatchEndedDialog(title: string, message: string, onAcknowledge: () => void): void {
    this.showDialog(title, message, onAcknowledge);
  }

  // Full teardown back to NetMenu — used for the voluntary Esc-leave
  // confirm and after a match-ended dialog's OK (see game/app.ts).
  forceLeaveMatch(): void {
    this.backFromLobby();
  }

  // --- Host/join lifecycle ---

  private teardownLobby(): void {
    this.unsubChange?.();
    this.unsubError?.();
    this.unsubStart?.();
    this.unsubChange = null;
    this.unsubError = null;
    this.unsubStart = null;
    this.lobby = null;
  }

  private wireLobby(lobby: NetLobby, transport: NetTransport): void {
    this.unsubChange = lobby.onChange(() => this.renderLobby());
    this.unsubError = lobby.onError((err) => this.handleLobbyError(err));
    this.unsubStart = lobby.onStart((msg: StartMessage) => {
      this.callbacks.onMatchStart({
        transport,
        roster: msg.roster,
        mode: msg.mode,
        level: msg.level,
        inputDelay: msg.inputDelay,
        selfPeerId: lobby.selfId,
      });
    });
  }

  private async doHost(name: string): Promise<void> {
    storeName(name);
    const token = ++this.sessionToken;
    this.teardownLobby();
    const code = generateRoomCode();
    const transport = createTransport();
    const lobby = new NetLobby(transport);
    this.setStatus(`Hosting room ${code}…`);
    try {
      await lobby.host(code, name);
    } catch {
      if (token !== this.sessionToken) return;
      this.setStatus('');
      this.showDialog('Relay unreachable', 'Could not start the room. Try again.');
      return;
    }
    if (token !== this.sessionToken) {
      lobby.leave();
      return;
    }
    this.setStatus('');
    this.lobby = lobby;
    this.wireLobby(lobby, transport);
    this.flow.goToNetLobby();
    this.renderLobby();
  }

  private async doJoin(rawCode: string, name: string, debugOverride?: JoinDebugOverride): Promise<void> {
    storeName(name);
    const code = normalizeRoomCode(rawCode);
    const token = ++this.sessionToken;
    this.teardownLobby();
    const transport = createTransport();
    const lobby = new NetLobby(transport);
    this.setStatus(`Joining ${code}…`);
    try {
      await lobby.join(code, name, debugOverride);
    } catch (e) {
      if (token !== this.sessionToken) return;
      this.setStatus('');
      const err = e as LobbyError;
      const [title, message] = this.dialogTextForError(err.reason, err.detail);
      this.showDialog(title, message);
      return;
    }
    if (token !== this.sessionToken) {
      lobby.leave();
      return;
    }
    this.setStatus('');
    this.lobby = lobby;
    this.wireLobby(lobby, transport);
    this.flow.goToNetLobby();
    this.renderLobby();
  }

  private handleLobbyError(err: LobbyError): void {
    if (err.reason === 'host-left') {
      const [title, message] = this.dialogTextForError(err.reason);
      this.showDialog(title, message, () => this.backFromLobby());
    }
    // Other LobbyError reasons only ever fire from within join()'s own
    // promise rejection (handled in doJoin above) — nothing else to do here.
  }

  private backFromLobby(): void {
    this.sessionToken++; // invalidate any in-flight host()/join()
    this.lobby?.leave();
    this.teardownLobby();
    this.flow.goToNetMenu();
  }

  private dialogTextForError(reason: LobbyErrorReason, detail?: string): [string, string] {
    switch (reason) {
      case 'not-found':
        return ['Room Not Found', 'No host responded for that room code. Double-check it and try again.'];
      case 'full':
        return ['Room Full', 'That room already has the maximum of 8 players.'];
      case 'started':
        return ['Match In Progress', 'That room already started its match.'];
      case 'version':
        return ['Version Mismatch', detail ?? "Your build doesn't match the host's build."];
      case 'relay-unreachable':
        return ['Relay Unreachable', 'Could not reach the room. Check your connection and try again.'];
      case 'host-left':
        return ['Host Left', 'The host left the game.'];
    }
  }

  // --- Shared info/error dialog (mirrors screens.ts's buildDialogShell) ---

  private buildDialog(): { overlay: HTMLDivElement; title: HTMLDivElement; message: HTMLDivElement } {
    const overlay = el('div', 'dialog-overlay');
    const panel = el('div', 'dialog-panel');
    const closeBtn = el('button', 'dialog-close');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.closeDialog());
    const body = el('div', 'dialog-body');
    const title = el('h2');
    const message = el('p');
    body.append(title, message);
    const okRow = el('div', 'dialog-ok-row');
    const okBtn = this.menuButton('OK', () => this.closeDialog());
    okRow.appendChild(okBtn);
    body.appendChild(okRow);
    panel.append(closeBtn, body);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeDialog();
    });
    return { overlay, title, message };
  }

  private showDialog(title: string, message: string, onClose?: () => void): void {
    this.dialogTitleEl.textContent = title;
    this.dialogMessageEl.textContent = message;
    this.dialogOnClose = onClose ?? null;
    this.dialogOverlayEl.classList.add('visible');
  }

  private closeDialog(): void {
    this.dialogOverlayEl.classList.remove('visible');
    const cb = this.dialogOnClose;
    this.dialogOnClose = null;
    cb?.();
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
}
