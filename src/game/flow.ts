import type { GameState } from '../sim/types.ts';
import { rebuildLevel, resetGame } from '../sim/simulation.ts';
import { LEVEL_INTRO_DURATION_TICKS } from '../config/constants.ts';

// FSM: Menu -> TankSetup -> LevelIntro(1) -> Playing <-> LevelIntro(n+1) on
// flag clear, or Playing -> GameOver -> (Enter) -> Menu. Pause and the
// Esc "quit to menu" confirm are orthogonal flags layered on top of
// Playing/LevelIntro rather than their own phases, so cancelling either
// always resumes exactly where it left off.
export type FlowPhase = 'Menu' | 'TankSetup' | 'Playing' | 'LevelIntro' | 'GameOver';

export class GameFlow {
  phase: FlowPhase = 'Menu';
  paused = false;
  confirmQuit = false;
  private introTicksRemaining = 0;

  handleEvents(state: GameState): void {
    for (const event of state.events) {
      if (event.type === 'LevelComplete') {
        rebuildLevel(state, state.level + 1);
        this.phase = 'LevelIntro';
        this.introTicksRemaining = LEVEL_INTRO_DURATION_TICKS;
      } else if (event.type === 'GameOver') {
        this.phase = 'GameOver';
      }
    }
  }

  // Advances the intro-card timer by one sim tick.
  tick(): void {
    if (this.phase !== 'LevelIntro') return;
    this.introTicksRemaining--;
    if (this.introTicksRemaining <= 0) this.phase = 'Playing';
  }

  // The sim only advances while one of these two phases is active (see
  // app.ts) — Menu/TankSetup/GameOver all hold the world frozen.
  get isGameplayActive(): boolean {
    return this.phase === 'Playing' || this.phase === 'LevelIntro';
  }

  // Bypasses the intro timer — used by debug hooks for deterministic tests.
  forcePlaying(): void {
    this.phase = 'Playing';
    this.introTicksRemaining = 0;
  }

  togglePause(): void {
    if (!this.isGameplayActive) return; // nothing to pause on menu/setup/game-over
    this.paused = !this.paused;
    if (!this.paused) this.confirmQuit = false;
  }

  // Esc during gameplay: pause and raise the "return to menu?" confirm card.
  requestQuitToMenu(): void {
    if (!this.isGameplayActive) return;
    this.paused = true;
    this.confirmQuit = true;
  }

  cancelQuitToMenu(): void {
    this.confirmQuit = false;
    this.paused = false;
  }

  // Confirmed from the Esc dialog, or a fresh Enter on the Game Over card —
  // either way the run is over; caller is responsible for any score recording
  // before calling this (see app.ts, which reads state.score first).
  goToMenu(): void {
    this.phase = 'Menu';
    this.paused = false;
    this.confirmQuit = false;
  }

  goToTankSetup(): void {
    this.phase = 'TankSetup';
  }

  // Tank-setup screen's Start button already reset `state` via
  // resetGameWithLoadout(); this just starts the intro-card sequence.
  beginRun(): void {
    this.phase = 'LevelIntro';
    this.introTicksRemaining = LEVEL_INTRO_DURATION_TICKS;
  }

  // "Press Enter to restart" debug fast path — full reset straight back into
  // play, bypassing menu/tank-setup (see game/debug.ts `restart`).
  restart(state: GameState): void {
    resetGame(state);
    this.paused = false;
    this.confirmQuit = false;
    this.phase = 'LevelIntro';
    this.introTicksRemaining = LEVEL_INTRO_DURATION_TICKS;
  }

  get showMenu(): boolean {
    return this.phase === 'Menu';
  }

  get showTankSetup(): boolean {
    return this.phase === 'TankSetup';
  }

  get showLevelIntro(): boolean {
    return this.phase === 'LevelIntro';
  }

  get showPaused(): boolean {
    return this.paused && this.isGameplayActive && !this.confirmQuit;
  }

  get showGameOver(): boolean {
    return this.phase === 'GameOver';
  }

  get showConfirmQuit(): boolean {
    return this.confirmQuit;
  }
}
