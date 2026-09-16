import { useMemo } from 'react';
import { barStyle, binsToValues, histogramRange, populationSd } from '../../shared/algorithms';

interface Props {
  bins: number[];
  modBins: number[];
  count: number;
  /** False before the session has started: bars are neutral cyan and no marker is drawn. */
  hasCount: boolean;
  myGuess: number | null;
  /** Projected final count, or null to hide the arrow. */
  projected: number | null;
}

export function Histogram({ bins, modBins, count, hasCount, myGuess, projected }: Props) {
  const { min, max, cols, maxN, total } = useMemo(() => {
    const combined = bins.map((n, i) => n + (modBins[i] ?? 0));
    const [lo, hi] = histogramRange(combined, hasCount ? count : 0);
    const sigma = populationSd(binsToValues(bins));
    const cols = [];
    let maxN = 1;
    let total = 0;
    for (let x = lo; x <= hi; x++) {
      const n = bins[x] ?? 0;
      const m = modBins[x] ?? 0;
      maxN = Math.max(maxN, n + m);
      total += n;
      cols.push({ x, n, m, style: barStyle(x, count, sigma, hasCount) });
    }
    return { min: lo, max: hi, cols, maxN, total };
  }, [bins, modBins, count, hasCount]);

  const span = max - min + 1;
  const pct = (x: number) => `${((x - min + 0.5) / span) * 100}%`;
  const labelEvery = span <= 14 ? 1 : span <= 28 ? 2 : span <= 42 ? 3 : 5;

  return (
    <div className="hist" aria-label="Histogram of guesses">
      <div className="hist-plot">
        <div className="hist-cols">
          {cols.map((c) => (
            <div className="hist-col" key={c.x}>
              {c.m > 0 && (
                <div
                  className="hist-bar mod"
                  style={{
                    height: `${(c.m / maxN) * 100}%`,
                    borderColor: c.style.color,
                    opacity: c.style.opacity,
                  }}
                  title={`${c.m} moderator guess${c.m === 1 ? '' : 'es'} of ${c.x} (not scored)`}
                />
              )}
              <div
                className="hist-bar"
                style={{
                  height: `${(c.n / maxN) * 100}%`,
                  backgroundColor: c.style.color,
                  opacity: c.style.opacity,
                  boxShadow: c.n > 0 && c.style.t < 0.15 && hasCount ? `0 0 10px ${c.style.color}88` : undefined,
                }}
                title={`${c.n} guess${c.n === 1 ? '' : 'es'} of ${c.x}`}
              />
            </div>
          ))}
        </div>
        {total === 0 && modBins.every((m) => m === 0) && <div className="hist-empty">Waiting for the first guess…</div>}
        {hasCount && <div className="hist-marker" style={{ left: pct(count) }} />}
      </div>
      <div className="hist-axis">
        {cols.map((c) => (
          <span key={c.x}>{(c.x - min) % labelEvery === 0 ? c.x : ''}</span>
        ))}
      </div>
      <div className="hist-under">
        {myGuess !== null && myGuess >= min && myGuess <= max && (
          <div className="hist-you" style={{ left: pct(myGuess) }}>
            <span className="tick" />
            you
          </div>
        )}
        {projected !== null && (
          <div className="hist-proj" style={{ left: pct(Math.min(max + 0.5, Math.max(min - 0.5, projected))) }}>
            <span className="arrow" />
            projected {Math.round(projected)}
          </div>
        )}
      </div>
    </div>
  );
}
