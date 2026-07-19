import type { Command } from '../sim/commands.ts';

// Keys the game handles itself; the browser's default action (scroll, focus
// change, menu, etc.) is suppressed for these.
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
