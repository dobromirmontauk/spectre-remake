import type { Command } from '../sim/commands.ts';
import type { EnemyKind, GameMode, Loadout } from '../sim/types.ts';

// window.__game hooks used for deterministic Playwright verification.
export interface DebugHooks {
  getState(): unknown;
  pause(): void;
  resume(): void;
  stepTicks(n: number): void;
  pressCommand(cmd: Partial<Command>, ticks: number): void;
  setLevel(n: number): void;
  collectAllFlags(): void;
  setGod(on: boolean): void;
  spawnEnemyAt(x: number, z: number, kind?: EnemyKind): void;
  killAllEnemies(): void;
  setLives(n: number): void;
  fire(): void;
  cycleCamera(): void;
  restart(): void;
  gotoMenu(): void;
  // `opts.mode` defaults to 'solo' (identical to the original 1P-only
  // behavior); pass 'coop'/'duel' + opts.loadout2 to start a 2P match.
  startGame(loadout?: Loadout, opts?: { mode?: GameMode; loadout2?: Loadout }): void;
  setFilled(on: boolean): void;
  setMuted(on: boolean): void;
}

declare global {
  interface Window {
    __game?: DebugHooks;
  }
}

export function installDebugApi(hooks: DebugHooks): void {
  window.__game = hooks;
}
