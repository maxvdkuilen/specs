import { describe, expect, it } from 'vitest';
import {
  barStyle,
  computeRatingUpdates,
  formatClock,
  hexToOklch,
  histogramRange,
  median,
  oklchToHex,
  ordinal,
  populationSd,
  projectFinal,
  rampColor,
  rankByError,
  sessionStats,
  NEON_CYAN,
  NEON_GREEN,
  NEON_RED,
  NEON_YELLOW,
  PASSED_BAR_OPACITY,
} from './algorithms';

describe('statistics', () => {
  it('median handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it('population sd divides by n', () => {
    expect(populationSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 10);
    expect(populationSd([5])).toBe(0);
  });
  it('sessionStats counts exact and within-SD bands', () => {
    const s = sessionStats([2, 4, 4, 4, 5, 5, 7, 9], 5);
    expect(s.guessCount).toBe(8);
    expect(s.guessSd).toBeCloseTo(2);
    expect(s.guessMean).toBe(5);
    expect(s.guessMedian).toBe(4.5);
    expect(s.exactCount).toBe(2);
    expect(s.within1Sd).toBe(6); // 4,4,4,5,5,7
    expect(s.within2Sd).toBe(8);
  });
});

describe('color ramp', () => {
  it('round-trips hex through OKLCH', () => {
    for (const hex of [NEON_GREEN, NEON_YELLOW, NEON_RED, NEON_CYAN, '#000000', '#FFFFFF', '#123456']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex.toUpperCase());
    }
  });
  it('hits the stops exactly', () => {
    expect(rampColor(0)).toBe(NEON_GREEN);
    expect(rampColor(0.5)).toBe(NEON_YELLOW);
    expect(rampColor(1)).toBe(NEON_RED);
  });
  it('midpoints stay bright, not muddy', () => {
    const { l: lMid } = hexToOklch(rampColor(0.25));
    const { l: lGreen } = hexToOklch(NEON_GREEN);
    const { l: lYellow } = hexToOklch(NEON_YELLOW);
    expect(lMid).toBeGreaterThan(Math.min(lGreen, lYellow) - 0.05);
  });
  it('barStyle follows d / (2 sigma) with sigma floored at 1', () => {
    expect(barStyle(10, 10, 3).t).toBe(0);
    expect(barStyle(13, 10, 3).t).toBeCloseTo(0.5);
    expect(barStyle(16, 10, 3).t).toBe(1);
    expect(barStyle(40, 10, 3).t).toBe(1);
    expect(barStyle(11, 10, 0.2).t).toBe(0.5); // sigma -> 1
    expect(barStyle(13, 10, 3).color).toBe(NEON_YELLOW);
  });
  it('passed bars fade, others do not', () => {
    expect(barStyle(4, 10, 2).opacity).toBe(PASSED_BAR_OPACITY);
    expect(barStyle(10, 10, 2).opacity).toBe(1);
    expect(barStyle(12, 10, 2).opacity).toBe(1);
  });
  it('is neutral cyan before the session opens', () => {
    expect(barStyle(3, 0, 2, false)).toEqual({ color: NEON_CYAN, t: 0, opacity: 1 });
  });
  it('histogram range covers max(guess, count) + 2', () => {
    const bins = new Array(51).fill(0);
    bins[7] = 3;
    expect(histogramRange(bins, 2)).toEqual([0, 9]);
    expect(histogramRange(bins, 12)).toEqual([0, 14]);
    expect(histogramRange(new Array(51).fill(0), 0)).toEqual([0, 2]);
  });
});

describe('projection', () => {
  const T = 4500;
  it('with no past lectures and no crowd, extrapolates the observed rate', () => {
    // 4 removals in 900 s -> 4 more per 900 s over the remaining 3600 s = 16 more
    expect(projectFinal({ count: 4, elapsedSec: 900, durationSec: T, crowdTauSec: 0 })).toBe(20);
  });
  it('never projects below the current count', () => {
    expect(projectFinal({ count: 20, elapsedSec: 4500, durationSec: T })).toBe(20);
    expect(projectFinal({ count: 11, elapsedSec: 180, durationSec: 180, crowdMedian: 7 })).toBe(11);
  });
  it('the crowd median is only a weak stabiliser, and only before any lecture has finished', () => {
    const withCrowd = projectFinal({ count: 1, elapsedSec: 120, durationSec: T, crowdMedian: 10 });
    const pure = projectFinal({ count: 1, elapsedSec: 120, durationSec: T, crowdTauSec: 0 });
    expect(pure).toBeCloseTo(1 + (1 / 120) * 4380, 0);
    expect(withCrowd).toBeLessThan(pure);
    expect(withCrowd).toBeGreaterThan(20); // still mostly the observed rate
    const past = [{ finalCount: 10, durationSec: T }];
    const withPast = projectFinal({ count: 1, elapsedSec: 120, durationSec: T, crowdMedian: 10, pastLectures: past });
    const withPastNoCrowd = projectFinal({ count: 1, elapsedSec: 120, durationSec: T, crowdMedian: null, pastLectures: past });
    expect(withPast).toBe(withPastNoCrowd);
  });
  it('past lectures weigh in gradually: none, a third, half, then full tau', () => {
    const c = 2;
    const e = 600;
    const past = (n: number) => Array.from({ length: n }, () => ({ finalCount: 12, durationSec: T }));
    const expected = (n: number) => {
      const tau = 600 * (n / (n + 2));
      const rate = (c + (12 / T) * tau) / (e + tau);
      return Math.round((c + rate * (T - e)) * 10) / 10;
    };
    for (const n of [1, 2, 5, 20]) {
      expect(projectFinal({ count: c, elapsedSec: e, durationSec: T, pastLectures: past(n), crowdTauSec: 0 })).toBe(expected(n));
    }
    // More past lectures pull the projection closer to what the past rate alone would give.
    const pastOnly = c + (12 / T) * (T - e);
    const p1 = projectFinal({ count: c, elapsedSec: e, durationSec: T, pastLectures: past(1), crowdTauSec: 0 });
    const p20 = projectFinal({ count: c, elapsedSec: e, durationSec: T, pastLectures: past(20), crowdTauSec: 0 });
    expect(Math.abs(p20 - pastOnly)).toBeLessThan(Math.abs(p1 - pastOnly));
  });
  it('scales the prior down for short lectures so simulations behave like real ones', () => {
    // A 3-minute lecture with many past lectures: prior tau = 600 * (180/4500) * ~1 = 24 s; the count dominates.
    const past = Array.from({ length: 20 }, () => ({ finalCount: 12, durationSec: 4500 }));
    const p = projectFinal({ count: 6, elapsedSec: 90, durationSec: 180, pastLectures: past });
    expect(p).toBeGreaterThan(10);
    expect(p).toBeLessThan(13);
  });
});

describe('elo', () => {
  it('ranks with averaged ties', () => {
    expect(rankByError([0, 2, 2, 5])).toEqual([1, 2.5, 2.5, 4]);
    expect(rankByError([3, 3, 3])).toEqual([2, 2, 2]);
  });
  it('is zero-sum among equals and rewards the best guess', () => {
    const ps = [
      { userId: 1, guess: 10, rating: 1000, sessionsPlayed: 0 },
      { userId: 2, guess: 12, rating: 1000, sessionsPlayed: 0 },
      { userId: 3, guess: 20, rating: 1000, sessionsPlayed: 0 },
    ];
    const u = computeRatingUpdates(ps, 10);
    expect(u[0].rank).toBe(1);
    expect(u[0].ratingAfter).toBe(1024); // K=48 * (1 - 0.5)
    expect(u[1].ratingAfter).toBe(1000);
    expect(u[2].ratingAfter).toBe(976);
    expect(u.reduce((s, x) => s + (x.ratingAfter - x.ratingBefore), 0)).toBe(0);
  });
  it('uses pre-session ratings and the lower K after 5 sessions', () => {
    const ps = [
      { userId: 1, guess: 10, rating: 1200, sessionsPlayed: 9 },
      { userId: 2, guess: 11, rating: 1000, sessionsPlayed: 9 },
    ];
    const u = computeRatingUpdates(ps, 10);
    const expectedHigh = 1 / (1 + Math.pow(10, (1000 - 1200) / 400));
    expect(u[0].expected).toBeCloseTo(expectedHigh);
    expect(u[0].ratingAfter).toBe(Math.round(1200 + 32 * (1 - expectedHigh)));
    expect(u[1].ratingAfter).toBe(Math.round(1000 + 32 * (0 - (1 - expectedHigh))));
  });
  it('does not change the rating of a lone participant', () => {
    const u = computeRatingUpdates([{ userId: 7, guess: 3, rating: 1042, sessionsPlayed: 2 }], 5);
    expect(u).toHaveLength(1);
    expect(u[0].ratingAfter).toBe(1042);
    expect(u[0].error).toBe(2);
  });
  it('returns nothing for no participants', () => {
    expect(computeRatingUpdates([], 5)).toEqual([]);
  });
});

describe('formatting', () => {
  it('ordinals', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(22)).toBe('22nd');
  });
  it('clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(372)).toBe('6:12');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(3725)).toBe('1:02:05');
  });
});
