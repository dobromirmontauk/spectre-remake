// Difficulty ramp tables per level.

import { themeForLevel, type Theme } from './palette.ts';
import {
  ENEMY_FIRE_COOLDOWN_FLOOR_TICKS,
  ENEMY_FIRE_COOLDOWN_LEVEL1_TICKS,
  ENEMY_FIRE_COOLDOWN_RAMP_LEVELS,
} from './constants.ts';

export interface LevelConfig {
  level: number;
  theme: Theme;
  enemyCount: number;
  hunterCount: number; // subset of enemyCount that are orange hunters (level 6+)
  enemyBaseShield: number;
  hasHunters: boolean; // orange cone tanks, level 6+
  grenadesUnlocked: boolean; // level 10+
  enemySpeedMultiplier: number; // applied to ENEMY_BASE_MAX_SPEED / HUNTER_BASE_MAX_SPEED
  enemyFireCooldownTicks: number; // base cooldown between enemy shots, ramps down with level
}

export function levelConfig(level: number): LevelConfig {
  const shieldBonus = Math.floor((level - 1) / 10); // +1 every 10 levels
  const hasHunters = level >= 6;
  const enemyCount = Math.min(2 + Math.floor(level / 2), 12);
  const hunterCount = hasHunters ? Math.min(1 + Math.floor((level - 6) / 3), enemyCount) : 0;
  const rampT = Math.min(1, (level - 1) / (ENEMY_FIRE_COOLDOWN_RAMP_LEVELS - 1));
  return {
    level,
    theme: themeForLevel(level),
    enemyCount,
    hunterCount,
    enemyBaseShield: 3 + shieldBonus,
    hasHunters,
    grenadesUnlocked: level >= 10,
    enemySpeedMultiplier: 1 + Math.min(0.5, level * 0.015),
    enemyFireCooldownTicks: Math.round(
      ENEMY_FIRE_COOLDOWN_LEVEL1_TICKS + (ENEMY_FIRE_COOLDOWN_FLOOR_TICKS - ENEMY_FIRE_COOLDOWN_LEVEL1_TICKS) * rampT,
    ),
  };
}
