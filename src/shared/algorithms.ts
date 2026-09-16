/**
 * Pure, dependency-free game math shared by server and client.
 * Covers PRD section 7: bar coloring (7.1), projection (7.2), session
 * statistics (7.3) and the Elo-style rating (7.4).
 */

// ---------------------------------------------------------------------------
// Basic statistics
// ---------------------------------------------------------------------------

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Population standard deviation (divides by n, not n-1). */
export function populationSd(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return Math.sqrt(acc / values.length);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Expand a histogram (index = guess value, entry = number of guesses) into a flat list of values. */
export function binsToValues(bins: number[]): number[] {
  const out: number[] = [];
  bins.forEach((n, value) => {
    for (let i = 0; i < n; i++) out.push(value);
  });
  return out;
}

// ---------------------------------------------------------------------------
// 7.3 Session statistics
// ---------------------------------------------------------------------------

export interface SessionStats {
  finalCount: number;
  guessCount: number;
  guessMean: number;
  guessMedian: number;
  guessSd: number;
  exactCount: number;
  within1Sd: number;
  within2Sd: number;
}

export function sessionStats(guesses: number[], finalCount: number): SessionStats {
  const sd = populationSd(guesses);
  let exact = 0;
  let w1 = 0;
  let w2 = 0;
  for (const g of guesses) {
    const d = Math.abs(g - finalCount);
    if (d === 0) exact++;
    if (d <= sd) w1++;
    if (d <= 2 * sd) w2++;
  }
  return {
    finalCount,
    guessCount: guesses.length,
    guessMean: mean(guesses),
    guessMedian: median(guesses),
    guessSd: sd,
    exactCount: exact,
    within1Sd: w1,
    within2Sd: w2,
  };
}

// ---------------------------------------------------------------------------
// 7.1 Histogram bar coloring (interpolated in OKLCH)
// ---------------------------------------------------------------------------

export const NEON_GREEN = '#39FF14';
export const NEON_YELLOW = '#FFE600';
export const NEON_RED = '#FF3864';
export const NEON_CYAN = '#00F0FF';
export const PASSED_BAR_OPACITY = 0.55;

type Oklch = { l: number; c: number; h: number };

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const to = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return ('#' + to(r) + to(g) + to(b)).toUpperCase();
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

export function oklchToHex({ l: L, c, h }: Oklch): string {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return rgbToHex([linearToSrgb(clamp(r, 0, 1)), linearToSrgb(clamp(g, 0, 1)), linearToSrgb(clamp(bl, 0, 1))]);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpHue(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  let h = a + d * t;
  if (h < 0) h += 360;
  if (h >= 360) h -= 360;
  return h;
}

const STOPS: { t: number; color: Oklch }[] = [
  { t: 0, color: hexToOklch(NEON_GREEN) },
  { t: 0.5, color: hexToOklch(NEON_YELLOW) },
  { t: 1, color: hexToOklch(NEON_RED) },
];

/** Interpolate the green -> yellow -> red ramp at t in [0, 1], in OKLCH. */
export function rampColor(t: number): string {
  const tt = clamp(t, 0, 1);
  let i = 0;
  while (i < STOPS.length - 2 && tt > STOPS[i + 1].t) i++;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const local = (tt - a.t) / (b.t - a.t);
  return oklchToHex({
    l: lerp(a.color.l, b.color.l, local),
    c: lerp(a.color.c, b.color.c, local),
    h: lerpHue(a.color.h, b.color.h, local),
  });
}

export interface BarStyle {
  /** Hex color of the bar. */
  color: string;
  /** 0 = at the count, 1 = two SDs away or more. */
  t: number;
  /** Bar opacity: passed bars (x < count) fade to 55%. */
  opacity: number;
}

/**
 * Bar color for guess value `x` given the current count and the spread of the crowd.
 * `sigma` is the population SD of the guesses; it is floored at 1 here.
 * Pass `hasCount = false` before the session is open: every bar is neutral cyan.
 */
export function barStyle(x: number, count: number, sigma: number, hasCount = true): BarStyle {
  if (!hasCount) return { color: NEON_CYAN, t: 0, opacity: 1 };
  const s = Math.max(sigma, 1);
  const d = Math.abs(x - count);
  const t = clamp(d / (2 * s), 0, 1);
  return { color: rampColor(t), t, opacity: x < count ? PASSED_BAR_OPACITY : 1 };
}

/** Inclusive x-axis range for the histogram: [0, max(maxGuess, count) + 2]. */
export function histogramRange(bins: number[], count: number, min = 0): [number, number] {
  let maxGuess = -1;
  bins.forEach((n, v) => {
    if (n > 0) maxGuess = v;
  });
  return [min, Math.max(maxGuess, count, min) + 2];
}

// ---------------------------------------------------------------------------
// 7.2 Projected final count
// ---------------------------------------------------------------------------

export interface ProjectionInput {
  count: number;
  elapsedSec: number;
  durationSec: number;
  /** Prior rate in events per second. */
  priorRate: number;
  /** Prior strength in seconds (default 600). */
  tauSec?: number;
}

/**
 * Blend of the observed rate with a prior rate, scaled to the full lecture. Rounded to 0.1.
 * Never below the current count: the final count cannot go down.
 */
export function projectFinal({ count, elapsedSec, durationSec, priorRate, tauSec = 600 }: ProjectionInput): number {
  const e = Math.max(0, elapsedSec);
  const raw = ((count + priorRate * tauSec) / (e + tauSec)) * durationSec;
  return Math.max(count, Math.round(raw * 10) / 10);
}

/**
 * Prior rate r0 (events / second): median of past final counts if any exist,
 * otherwise the median of this session's guesses. Returns 0 with no information.
 */
export function priorRate(pastFinalCounts: number[], currentGuesses: number[], durationSec: number): number {
  if (durationSec <= 0) return 0;
  if (pastFinalCounts.length > 0) return median(pastFinalCounts) / durationSec;
  if (currentGuesses.length > 0) return median(currentGuesses) / durationSec;
  return 0;
}

// ---------------------------------------------------------------------------
// 7.4 Elo-style rating
// ---------------------------------------------------------------------------

export interface EloConfig {
  kNew: number;
  k: number;
  newSessions: number;
}

export const DEFAULT_ELO: EloConfig = { kNew: 48, k: 32, newSessions: 5 };

export interface Participant {
  userId: number;
  guess: number;
  rating: number;
  sessionsPlayed: number;
}

export interface RatingUpdate {
  userId: number;
  error: number;
  /** Average competition rank (ties share the mean of the positions they occupy). 1-based. */
  rank: number;
  ratingBefore: number;
  ratingAfter: number;
  actual: number;
  expected: number;
}

/** Ranks by error ascending; tied errors share the average of their positions. */
export function rankByError(errors: number[]): number[] {
  const idx = errors.map((_, i) => i).sort((a, b) => errors[a] - errors[b]);
  const ranks = new Array<number>(errors.length);
  let pos = 0;
  while (pos < idx.length) {
    let end = pos;
    while (end + 1 < idx.length && errors[idx[end + 1]] === errors[idx[pos]]) end++;
    const avg = (pos + 1 + end + 1) / 2;
    for (let k = pos; k <= end; k++) ranks[idx[k]] = avg;
    pos = end + 1;
  }
  return ranks;
}

export function kFactor(sessionsPlayed: number, cfg: EloConfig = DEFAULT_ELO): number {
  return sessionsPlayed < cfg.newSessions ? cfg.kNew : cfg.k;
}

/**
 * Compute rating updates for one finished session. Uses pre-session ratings
 * for every opponent. With a single participant, the rating is unchanged.
 */
export function computeRatingUpdates(
  participants: Participant[],
  finalCount: number,
  cfg: EloConfig = DEFAULT_ELO,
): RatingUpdate[] {
  const n = participants.length;
  if (n === 0) return [];
  const errors = participants.map((p) => Math.abs(p.guess - finalCount));
  const ranks = rankByError(errors);
  if (n === 1) {
    const p = participants[0];
    return [
      {
        userId: p.userId,
        error: errors[0],
        rank: 1,
        ratingBefore: p.rating,
        ratingAfter: p.rating,
        actual: 1,
        expected: 1,
      },
    ];
  }
  return participants.map((p, i) => {
    const actual = (n - ranks[i]) / (n - 1);
    let sum = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      sum += 1 / (1 + Math.pow(10, (participants[j].rating - p.rating) / 400));
    }
    const expected = sum / (n - 1);
    const k = kFactor(p.sessionsPlayed, cfg);
    const ratingAfter = Math.round(p.rating + k * (actual - expected));
    return {
      userId: p.userId,
      error: errors[i],
      rank: ranks[i],
      ratingBefore: p.rating,
      ratingAfter,
      actual,
      expected,
    };
  });
}

// ---------------------------------------------------------------------------
// Small display helpers
// ---------------------------------------------------------------------------

export function ordinal(n: number): string {
  const r = Math.round(n);
  const mod100 = r % 100;
  if (mod100 >= 11 && mod100 <= 13) return r + 'th';
  switch (r % 10) {
    case 1:
      return r + 'st';
    case 2:
      return r + 'nd';
    case 3:
      return r + 'rd';
    default:
      return r + 'th';
  }
}

/** Format seconds as m:ss (or h:mm:ss above an hour). Negative values clamp to 0:00. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}
