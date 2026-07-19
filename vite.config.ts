import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// Stamped into the build as `__BUILD_HASH__` (see net/protocol.ts) for the
// net-play version-mismatch check. 'dev' outside a git checkout (or if git
// itself is unavailable) — never worth failing the build over.
function gitShortHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: './',
  define: {
    __BUILD_HASH__: JSON.stringify(gitShortHash()),
  },
  server: {
    watch: {
      // dist/index.html counts as an HTML entry to Vite's watcher, so a
      // `npm run build` while a dev tab is open force-reloads the game
      // mid-session. Reference screenshots and Playwright artifacts are
      // likewise non-source.
      ignored: ['**/dist/**', '**/reference/**', '**/.playwright-mcp/**'],
    },
  },
});
