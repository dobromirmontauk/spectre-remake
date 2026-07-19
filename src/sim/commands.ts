// Command is the intent produced by any command source — keyboard input,
// AI, or (later) a remote peer — and consumed identically by step().

export interface Command {
  turn: -1 | 0 | 1; // -1 left, 1 right
  thrust: -1 | 0 | 1; // 1 forward, -1 reverse
  fire: boolean;
  grenade: boolean;
}

export const NEUTRAL_COMMAND: Command = {
  turn: 0,
  thrust: 0,
  fire: false,
  grenade: false,
};
