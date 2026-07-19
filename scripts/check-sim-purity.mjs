// Fails the build if src/sim/ contains anything non-deterministic or a
// three.js/DOM import (sim/CLAUDE.md's "no three.js/DOM imports; no
// Math.random(), Date.now(), or wall-clock" contract). Run via
// `npm run build` (see package.json).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const simDir = path.join(root, 'src', 'sim');

// dmath.ts is the deterministic replacement itself — it's allowed to call
// Math.sqrt/abs/floor (the only IEEE-754-exact primitives it's built from,
// per its own header comment) and to *mention* the forbidden names in
// comments explaining why they're avoided.
const EXEMPT_FILE = 'dmath.ts';

const FORBIDDEN_PATTERNS = [
  { name: 'Math.sin', re: /\bMath\.sin\s*\(/ },
  { name: 'Math.cos', re: /\bMath\.cos\s*\(/ },
  { name: 'Math.tan', re: /\bMath\.tan\s*\(/ },
  { name: 'Math.atan', re: /\bMath\.atan\s*\(/ }, // also catches Math.atan2(
  { name: 'Math.asin', re: /\bMath\.asin\s*\(/ },
  { name: 'Math.acos', re: /\bMath\.acos\s*\(/ },
  { name: 'Math.hypot', re: /\bMath\.hypot\s*\(/ },
  { name: 'Math.random', re: /\bMath\.random\s*\(/ },
  { name: 'Math.exp', re: /\bMath\.exp\s*\(/ },
  { name: 'Math.log', re: /\bMath\.log\s*\(/ },
  { name: 'Math.pow', re: /\bMath\.pow\s*\(/ },
  { name: 'Math.cbrt', re: /\bMath\.cbrt\s*\(/ },
  { name: 'Date.', re: /\bDate\.(now|parse)\s*\(|new Date\s*\(/ },
  { name: 'performance.', re: /\bperformance\.\w+\s*\(/ },
  { name: '.sort(', re: /\.sort\s*\(/ },
  { name: 'new Set(', re: /\bnew Set\s*[(<]/ },
  { name: 'new Map(', re: /\bnew Map\s*[(<]/ },
  { name: 'three.js import', re: /from\s+['"]three['"]/ },
  { name: 'DOM global', re: /\b(document|window)\b/ },
];

function stripComments(source) {
  // Strips // line comments and /* */ block comments so pattern matches
  // only look at live code — comments are allowed to mention any of this
  // (e.g. explaining why Math.sin isn't used).
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

let violations = [];

for (const file of walk(simDir)) {
  const base = path.basename(file);
  if (base === EXEMPT_FILE) continue;

  const raw = readFileSync(file, 'utf8');
  const code = stripComments(raw);
  const lines = code.split('\n');

  for (const { name, re } of FORBIDDEN_PATTERNS) {
    lines.forEach((line, i) => {
      if (re.test(line)) {
        violations.push(`${path.relative(root, file)}:${i + 1}: forbidden pattern "${name}" — ${line.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error('sim purity check FAILED:\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(`\n${violations.length} violation(s). src/sim/ must stay pure, plain-data, and deterministic (see src/sim/CLAUDE.md).`);
  process.exit(1);
}

console.log(`sim purity check passed (${walk(simDir).length} files scanned).`);
