// Deterministic replacements for Math.sin/cos/atan2/hypot, for use in sim/
// only (render/, audio/, hud/ keep native Math — they don't affect gameplay
// outcomes and native transcendentals are faster/more precise for cosmetics).
//
// WHY THIS FILE EXISTS (the determinism argument):
// V8 (Chrome/Node), SpiderMonkey (Firefox) and JavaScriptCore (Safari) each
// ship their own libm, and ECMA-262 only requires Math.sin/cos/atan2/hypot
// etc. to be "an implementation-approximated value" — NOT bit-for-bit
// identical across engines. A future lockstep multiplayer match replays the
// exact same (state, commands) on every peer; if one peer's engine rounds
// Math.sin differently in the last bit, that peer's tank position diverges
// from everyone else's by ~1e-16 on tick 1 — negligible on its own, but this
// sim is a chaotic feedback loop (heading feeds position feeds AI aim feeds
// discrete fire/no-fire decisions feeds damage feeds death/respawn), so the
// divergence compounds and typically produces a visibly different game
// within seconds. A single mismatched shot landing on one peer and missing
// on another is exactly the kind of bug a state-hash desync check (see
// sim/hash.ts) exists to catch — but the right fix is to not let it happen.
//
// Every operator below (+, -, *, /, <, >, ===) and every Math.sqrt/abs/floor
// call IS fully specified bit-for-bit by IEEE 754 (correctly-rounded
// results), and EVERY conformant JS engine implements IEEE 754 double
// arithmetic for these exactly. So: build sin/cos/atan2 out of nothing but
// those primitives (Cody-Waite range reduction with a two-part constant,
// then a fixed minimax polynomial on a small reduced interval) and the
// *result* is bit-identical across engines too — at the cost of ~1e-9 error
// relative to the native functions (see scripts/dmath-accuracy.mjs), far
// inside the 1e-7 tolerance the sim can tolerate before AI aim decisions or
// movement integration would visibly diverge.
//
// The polynomials below are the well-known fdlibm/cephes kernel coefficients
// (public-domain, reproduced in glibc, Java StrictMath, .NET's reference
// sources, etc.) — "cephes-style", not derived from scratch, because they
// are extensively tested minimax fits, not because of any licensing need
// (this file contains no copied source, only re-derived constants).

// --- Shared reduction constants ---
// Cody-Waite two-part representation of pi/2: PIO2_HI holds the top ~33 bits
// (so integer multiples of it up to a few thousand stay exactly
// representable), PIO2_LO is the remainder. Their sum approximates pi/2 to
// about 62 bits of precision, far more than a single double's 52 — this is
// what lets `x - n*PIO2_HI - n*PIO2_LO` cancel almost exactly instead of
// losing precision the way a naive `x - n*(Math.PI/2)` would for x not near
// zero.
const PIO2_HI = 1.57079632673412561417e0;
const PIO2_LO = 6.07710050650619224932e-11;

// 2*pi as the same two-part constant, scaled by 4. Multiplying by 4 (a power
// of two) is exact in IEEE 754 — no rounding is introduced, so this is still
// a faithful two-part 2*pi.
const TWO_PI_HI = PIO2_HI * 4;
const TWO_PI_LO = PIO2_LO * 4;

// Reciprocals used only to *estimate* which integer multiple to subtract;
// they don't need to be exact — correctness of the reduced remainder comes
// from the hi/lo subtraction above, not from these.
const INV_TWO_PI = 0.15915494309189535;
const INV_PIO2 = 0.6366197723675814;

// Round-to-nearest-integer (ties away from zero) built only from Math.floor
// and comparisons, per the "only +,-,*,/, comparisons, Math.sqrt/abs/floor"
// contract (Math.round is spec-deterministic too, but this keeps every
// helper in this file visibly built from the same small primitive set).
function roundNearest(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
}

// --- sin/cos kernels, valid for |r| <= pi/4 ---
// fdlibm __kernel_sin: degree-13 odd minimax polynomial (x, x^3, x^5, ...,
// x^13), better than 1 ULP accurate on this interval.
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

function kernelSin(x: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}

// fdlibm __kernel_cos: degree-12 even minimax polynomial, same interval.
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kernelCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - z * r);
}

// Reduces x to r2 in [-pi/4, pi/4] plus an integer octant k such that
// x = r2 + k*(pi/2), via two Cody-Waite reductions (first mod 2*pi to keep
// the intermediate small, then mod pi/2 to land in the kernels' domain).
function reduceToOctant(x: number): { r2: number; k: number } {
  const n = roundNearest(x * INV_TWO_PI);
  const r = x - n * TWO_PI_HI - n * TWO_PI_LO;

  const k = roundNearest(r * INV_PIO2);
  const r2 = r - k * PIO2_HI - k * PIO2_LO;
  return { r2, k };
}

// Deterministic replacement for Math.sin. Range-reduces to an octant of
// [-pi/4, pi/4] and picks the sin/cos kernel (with sign) that octant
// implies — the standard sin(r2 + k*pi/2) angle-sum expansion.
export function dsin(x: number): number {
  const { r2, k } = reduceToOctant(x);
  const octant = (((k % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  switch (octant) {
    case 0:
      return kernelSin(r2);
    case 1:
      return kernelCos(r2);
    case 2:
      return -kernelSin(r2);
    default:
      return -kernelCos(r2);
  }
}

// A single double sum of the two-part pi/2 constant — precise enough as an
// *input offset* here because dcos immediately re-reduces the shifted value
// from scratch in dsin; the lo bits lost in this one addition are far below
// the polynomial's own ~1e-15 error budget.
const HALF_PI = PIO2_HI + PIO2_LO;

// Deterministic replacement for Math.cos, built as dsin(x + pi/2) — the
// standard phase-shift identity — so there is exactly one range-reduction
// implementation to keep correct.
export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

// --- atan core, valid for 0 <= x <= 1 ---
// fdlibm atan's 5-region piecewise reduction + degree-~21 (two interleaved
// degree ~11 even-power series, s1 over odd powers z*z^n and s2 over
// z^2*z^2n) minimax polynomial. Reduces any finite x to one of five
// sub-intervals via a half-angle-like substitution, each with its own exact
// "already known" angle (atanHi/atanLo) added back — this is what gets
// sub-ULP accuracy across all of [0, +Infinity) instead of just [-1, 1], at
// the cost of a fixed 5-way branch instead of a single polynomial.
const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.11111104054623557880e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.65315727442169155270e-2;
const AT10 = 1.62858201153657823623e-2;

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];

// atan(x) for x >= 0 (the sign is restored by the caller, matching fdlibm's
// own structure of factoring sign out before this call).
function atanNonNegative(x: number): number {
  let id = -1;
  let t = x;
  if (t < 0.4375) {
    id = -1;
  } else if (t < 0.6875) {
    id = 0;
    t = (2 * t - 1) / (2 + t);
  } else if (t < 1.1875) {
    id = 1;
    t = (t - 1) / (t + 1);
  } else if (t < 2.4375) {
    id = 2;
    t = (t - 1.5) / (1 + 1.5 * t);
  } else {
    id = 3;
    t = -1 / t;
  }

  const z = t * t;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));

  if (id < 0) return t - t * (s1 + s2);
  const poly = t * (s1 + s2) - ATAN_LO[id]! - t;
  return ATAN_HI[id]! - poly;
}

function isNegativeZero(x: number): boolean {
  return x === 0 && 1 / x === -Infinity;
}

// Deterministic replacement for Math.atan2, matching its ±0/axis/infinity
// sign conventions exactly (verified against Math.atan2 in
// scripts/dmath-accuracy.mjs, including every zero/axis combination).
export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;

  if (y === 0) {
    const yNeg = isNegativeZero(y);
    if (x > 0 || (x === 0 && !isNegativeZero(x))) return yNeg ? -0 : 0;
    return yNeg ? -Math.PI : Math.PI;
  }

  if (x === 0) return y > 0 ? HALF_PI : -HALF_PI;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    // Infinity cases per Math.atan2's spec table; positions in this sim are
    // always finite, but handling this keeps datan2 a total, spec-matching
    // replacement rather than one with unhandled edge cases.
    const QUARTER_PI = HALF_PI / 2;
    if (!Number.isFinite(y)) {
      if (!Number.isFinite(x)) {
        const mag = x > 0 ? QUARTER_PI : Math.PI - QUARTER_PI;
        return y > 0 ? mag : -mag;
      }
      return y > 0 ? HALF_PI : -HALF_PI;
    }
    // y finite, x infinite.
    if (x > 0) return y > 0 ? 0 : -0;
    return y > 0 ? Math.PI : -Math.PI;
  }

  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const base = ax >= ay ? atanNonNegative(ay / ax) : HALF_PI - atanNonNegative(ax / ay);

  if (x > 0) return y > 0 ? base : -base;
  return y > 0 ? Math.PI - base : base - Math.PI;
}

// Deterministic replacement for Math.hypot(x, z). Math.hypot's extra
// internal scaling (to dodge overflow on huge inputs) is not specified
// bit-for-bit, unlike a plain sqrt(x*x+z*z) — and the sim's coordinates
// never approach the range where that scaling would matter, so the plain
// form is both simpler and the deterministic choice.
export function dlen(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}
