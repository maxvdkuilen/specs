import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ordinal } from '../../shared/algorithms';
import type { MyResult, SessionStatsWire } from '../../shared/types';

interface Props {
  stats: SessionStatsWire;
  myResult: MyResult | null;
  isModerator: boolean;
  onClose: () => void;
}

export function ResultsModal({ stats, myResult, isModerator, onClose }: Props) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sd = stats.guessSd;
  const delta = myResult && myResult.ratingAfter !== null && myResult.ratingBefore !== null ? myResult.ratingAfter - myResult.ratingBefore : null;
  const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Lecture results">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="center stack" style={{ gap: 4 }}>
          <div className="eyebrow">Final count</div>
          <div className="final">{stats.finalCount}</div>
        </div>

        <div className="stat-list">
          <div className="stat">
            <span>Guessed it exactly</span>
            <b>{people(stats.exactCount)}</b>
          </div>
          <div className="stat">
            <span>Within 1 SD (±{sd.toFixed(1)})</span>
            <b>{people(stats.within1Sd)}</b>
          </div>
          <div className="stat">
            <span>Within 2 SD (±{(2 * sd).toFixed(1)})</span>
            <b>{people(stats.within2Sd)}</b>
          </div>
        </div>

        {myResult ? (
          <div className="you-box">
            <div>
              You guessed <b>{myResult.guess}</b>. Off by <b>{myResult.error}</b>.
              {myResult.rank !== null && myResult.participants > 0 && (
                <>
                  {' '}
                  Finished <b>{ordinal(myResult.rank)}</b> of {myResult.participants}.
                </>
              )}
              {isModerator && <span className="dim"> Moderator guesses are not scored.</span>}
            </div>
            {delta !== null && (
              <div className={`delta ${delta >= 0 ? 'pos' : 'neg'}`}>
                {delta >= 0 ? '+' : '−'}
                {Math.abs(delta)} → {myResult.ratingAfter}
              </div>
            )}
            {myResult.rank !== null && delta === null && <div className="small">Rating change is loading…</div>}
          </div>
        ) : (
          <div className="you-box">
            <div className="small">Loading your result…</div>
          </div>
        )}

        <button className="btn btn-primary" onClick={() => navigate('/leaderboard')}>
          See leaderboard
        </button>
      </div>
    </div>
  );
}
