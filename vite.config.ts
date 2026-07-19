import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
