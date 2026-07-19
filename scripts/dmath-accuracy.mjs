// Sweeps dsin/dcos/datan2/dlen against native Math.* and fails if any sample
// exceeds 1e-7 error (the sim's determinism tolerance; dmath.ts aims for
// ~1e-9). Run with: node scripts/dmath-accuracy.mjs
//
// Imports the compiled sim output rather than re-implementing anything here
// — this checks the actual code that ships, not a copy of it.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distFile = path.join(root, 'dist-dmath-check', 'dmath.js');

execSync(
  `npx tsc --target es2020 --module es2020 --moduleResolution bundler --skipLibCheck --types --outDir dist-dmath-check src/sim/dmath.ts`,
  { cwd: root, stdio: 'inherit' },
);

if (!existsSync(distFile)) {
  console.error('dmath.js was not produced by the tsc build step');
  process.exit(1);
}

const { dsin, dcos, datan2, dlen } = await import(`${distFile}?t=${Date.now()}`);

const TOLERANCE = 1e-7;
let maxSinErr = 0;
let maxCosErr = 0;
let maxAtan2Err = 0;
let maxHypotErr = 0;
let failures = [];

function check(name, got, want, x, maxErrRef) {
  const err = Math.abs(got - want);
  if (err > maxErrRef.value) maxErrRef.value = err;
  if (err > TOLERANCE) failures.push(`${name}(${x}) = ${got}, want ${want}, err ${err}`);
}

const sinRef = { value: 0 };
const cosRef = { value: 0 };
const N = 1_000_000;
const RANGE = 4 * Math.PI;
for (let i = 0; i <= N; i++) {
  const x = -RANGE + (2 * RANGE * i) / N;
  check('dsin', dsin(x), Math.sin(x), x, sinRef);
  check('dcos', dcos(x), Math.cos(x), x, cosRef);
}
maxSinErr = sinRef.value;
maxCosErr = cosRef.value;

// Adversarial points: exact multiples of pi/2 (and neighbors), where octant
// reduction is most likely to pick the wrong branch or lose precision.
const adversarial = [];
for (let k = -16; k <= 16; k++) {
  const base = k * (Math.PI / 2);
  adversarial.push(base, base + 1e-9, base - 1e-9, base + 1e-6, base - 1e-6);
}
for (const x of adversarial) {
  check('dsin', dsin(x), Math.sin(x), x, sinRef);
  check('dcos', dcos(x), Math.cos(x), x, cosRef);
}

// atan2 sweep: unit-circle angles plus a grid of (y, x) pairs, plus every
// sign/zero/axis combination Math.atan2 special-cases.
const atan2Ref = { value: 0 };
for (let i = 0; i <= 2000; i++) {
  const angle = -Math.PI + (2 * Math.PI * i) / 2000;
  const y = Math.sin(angle) * 10;
  const x = Math.cos(angle) * 10;
  check('datan2', datan2(y, x), Math.atan2(y, x), `${y},${x}`, atan2Ref);
}
for (let gy = -5; gy <= 5; gy++) {
  for (let gx = -5; gx <= 5; gx++) {
    const y = gy * 3.7;
    const x = gx * 5.3;
    check('datan2', datan2(y, x), Math.atan2(y, x), `${y},${x}`, atan2Ref);
  }
}
const zeroish = [0, -0, 1, -1, 5, -5, Infinity, -Infinity];
for (const y of zeroish) {
  for (const x of zeroish) {
    check('datan2', datan2(y, x), Math.atan2(y, x), `${y},${x}`, atan2Ref);
  }
}
maxAtan2Err = atan2Ref.value;

// dlen (hypot replacement) sweep.
const hypotRef = { value: 0 };
for (let i = 0; i <= 5000; i++) {
  const x = -50 + (100 * i) / 5000;
  const z = Math.sin(i) * 30;
  check('dlen', dlen(x, z), Math.hypot(x, z), `${x},${z}`, hypotRef);
}
maxHypotErr = hypotRef.value;

console.log(`dsin   max error: ${maxSinErr.toExponential(3)}`);
console.log(`dcos   max error: ${maxCosErr.toExponential(3)}`);
console.log(`datan2 max error: ${maxAtan2Err.toExponential(3)}`);
console.log(`dlen   max error: ${maxHypotErr.toExponential(3)}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} sample(s) exceeded tolerance ${TOLERANCE}:`);
  for (const f of failures.slice(0, 20)) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`\nAll samples within tolerance ${TOLERANCE}.`);
