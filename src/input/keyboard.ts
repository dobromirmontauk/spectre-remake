import type { Command } from '../sim/commands.ts';

// Keys the game handles itself; the browser's default action (scroll, focus
// change, menu, etc.) is suppressed for these. P1 = arrows + Space (fire) +
// Alt/G (grenade); P2 (2P modes only) = WASD (W thrust, S reverse, A/D turn)
// + F (fire) + Q (grenade).
const GAME_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  ' ',
  'Tab',
  'Alt',
  'g',
  'G',
  'p',
  'P',
  's',
  'S',
  'm',
  'M',
  'w',
  'W',
  'a',
  'A',
  'd',
  'D',
  'f',
  'F',
  'q',
  'Q',
  'Enter',
  'Escape',
]);

export class KeyboardInput {
  private held = new Set<string>();
  // One-shot "was this key pressed since last consumed" flags, for keys that
  // trigger an edge-triggered action (camera cycle, pause toggle, restart)
  // rather than a continuously-held command.
  private edgePresses = new Set<string>();

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (GAME_KEYS.has(e.key)) e.preventDefault();
    if (!this.held.has(e.key)) this.edgePresses.add(e.key);
    this.held.add(e.key);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.key);
  };

  private onBlur = (): void => {
    this.held.clear();
  };

  // P1: arrow keys + Space (fire) + Alt/G (grenade) — identical to the
  // original 1-player scheme, unchanged.
  readCommand(): Command {
    // Heading convention: +turn rotates the nose toward +x, which is
    // screen-left in the chase/first-person view (camera looks along +forward,
    // so screen-right = forward x up = -x).
    let turn: -1 | 0 | 1 = 0;
    if (this.held.has('ArrowLeft')) turn = 1;
    else if (this.held.has('ArrowRight')) turn = -1;

    let thrust: -1 | 0 | 1 = 0;
    if (this.held.has('ArrowUp')) thrust = 1;
    else if (this.held.has('ArrowDown')) thrust = -1;

    const grenade = this.held.has('Alt') || this.held.has('g') || this.held.has('G');

    return { turn, thrust, fire: this.held.has(' '), grenade };
  }

  // P2 (2P co-op/duel only): WASD + F (fire) + Q (grenade). Same screen-left
  // turn convention as P1 (A -> turn=+1, per sim/CLAUDE.md's heading rule).
  readCommand2(): Command {
    let turn: -1 | 0 | 1 = 0;
    if (this.held.has('a') || this.held.has('A')) turn = 1;
    else if (this.held.has('d') || this.held.has('D')) turn = -1;

    let thrust: -1 | 0 | 1 = 0;
    if (this.held.has('w') || this.held.has('W')) thrust = 1;
    else if (this.held.has('s') || this.held.has('S')) thrust = -1;

    const fire = this.held.has('f') || this.held.has('F');
    const grenade = this.held.has('q') || this.held.has('Q');

    return { turn, thrust, fire, grenade };
  }

  // Returns true once for each fresh press of `key` (key-repeat-safe), then
  // clears the flag until the key is released and pressed again.
  consumeJustPressed(key: string): boolean {
    if (!this.edgePresses.has(key)) return false;
    this.edgePresses.delete(key);
    return true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
