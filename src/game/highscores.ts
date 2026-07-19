// Local high-score table (localStorage) — meta-game persistence, not part of
// the deterministic sim. Top 10 by score; ties broken by insertion order.

export interface HighScoreEntry {
  name: string; // 3-letter initials, arcade-style
  score: number;
  level: number;
}

const STORAGE_KEY = 'spectre.highscores.v1';
const MAX_ENTRIES = 10;

function isValidEntry(v: unknown): v is HighScoreEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.name === 'string' && typeof e.score === 'number' && typeof e.level === 'number';
}

export function loadHighScores(): HighScoreEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry).slice(0, MAX_ENTRIES);
  } catch {
    return []; // corrupt/unavailable storage — fail open to an empty table
  }
}

function saveHighScores(entries: HighScoreEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) — scores just
    // won't persist this session; not worth surfacing to the player.
  }
}

// Whether `score` would land in the top 10 (table isn't full, or beats the
// current lowest entry).
export function qualifiesForHighScore(score: number): boolean {
  const entries = loadHighScores();
  if (entries.length < MAX_ENTRIES) return score > 0;
  const lowest = entries[entries.length - 1];
  return lowest !== undefined && score > lowest.score;
}

export function recordHighScore(name: string, score: number, level: number): HighScoreEntry[] {
  const entries = loadHighScores();
  const initials = (name.trim().slice(0, 3) || 'AAA').toUpperCase();
  entries.push({ name: initials, score, level });
  entries.sort((a, b) => b.score - a.score);
  const trimmed = entries.slice(0, MAX_ENTRIES);
  saveHighScores(trimmed);
  return trimmed;
}
