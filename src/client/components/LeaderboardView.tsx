import { useEffect, useState } from 'react';
import { api } from '../api';
import type { LeaderboardResponse, LeaderboardRow } from '../../shared/types';

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" aria-hidden="true" />;
  const w = 48;
  const h = 18;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 2) + 1},${h - 2 - ((v - lo) / range) * (h - 4)}`);
  const up = values[values.length - 1] >= values[0];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={up ? 'var(--green)' : 'var(--red)'} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Row({ r, pinned = false }: { r: LeaderboardRow; pinned?: boolean }) {
  return (
    <div className={`lb-row${r.isMe ? ' me' : ''}${pinned ? ' pinned' : ''}`}>
      <span className={`rank${r.rank <= 3 ? ' top' : ''}`}>{r.rank}</span>
      <span className="name">
        <span className="u">{r.username}</span>
        {r.provisional && <span className="chip tag">provisional</span>}
      </span>
      <Spark values={r.spark} />
      <span className="meta">
        <span className="rating">{r.rating}</span>
        <span>
          {r.lastDelta !== null && (
            <span className={`delta ${r.lastDelta >= 0 ? 'pos' : 'neg'}`}>
              {r.lastDelta >= 0 ? '+' : '−'}
              {Math.abs(r.lastDelta)}
            </span>
          )}{' '}
          · {r.sessionsPlayed} {r.sessionsPlayed === 1 ? 'lecture' : 'lectures'}
        </span>
      </span>
    </div>
  );
}

const VISIBLE_TOP = 25;

export function LeaderboardView({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'season' | 'lecture'>('season');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api.leaderboard().then(setData).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="spinner" />;

  const limit = compact ? 10 : showAll ? Infinity : VISIBLE_TOP;
  const visible = data.season.slice(0, limit);
  const mePinned = data.me && !visible.some((r) => r.isMe) ? data.me : null;

  return (
    <div className="stack">
      {!compact && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'season'} className={tab === 'season' ? 'active' : ''} onClick={() => setTab('season')}>
            Season
          </button>
          <button role="tab" aria-selected={tab === 'lecture'} className={tab === 'lecture' ? 'active' : ''} onClick={() => setTab('lecture')}>
            This lecture
          </button>
        </div>
      )}

      {tab === 'season' && (
        <div className="lb">
          {visible.length === 0 && <div className="empty">Nobody has played a lecture yet. Be first.</div>}
          {visible.map((r) => (
            <Row key={r.userId} r={r} />
          ))}
          {!compact && data.season.length > VISIBLE_TOP && !showAll && (
            <button className="link-btn" style={{ alignSelf: 'center' }} onClick={() => setShowAll(true)}>
              Show all {data.season.length}
            </button>
          )}
          {mePinned && <Row r={mePinned} pinned />}
        </div>
      )}

      {tab === 'lecture' && (
        <div className="lb">
          {!data.lecture ? (
            <div className="empty">No finished lecture yet.</div>
          ) : (
            <>
              <div className="small center">
                {data.lecture.session.title} · final count <b className="mono" style={{ color: 'var(--text)' }}>{data.lecture.finalCount}</b>
              </div>
              {data.lecture.rows.map((r) => (
                <div key={r.username} className={`lb-row${r.isMe ? ' me' : ''}`}>
                  <span className={`rank${r.rank <= 3 ? ' top' : ''}`}>{r.rank}</span>
                  <span className="name">
                    <span className="u">{r.username}</span>
                  </span>
                  <span className="small mono">guess {r.guess}</span>
                  <span className="meta">
                    <span className="rating">±{r.error}</span>
                    {r.ratingDelta !== null && (
                      <span className={`delta ${r.ratingDelta >= 0 ? 'pos' : 'neg'}`}>
                        {r.ratingDelta >= 0 ? '+' : '−'}
                        {Math.abs(r.ratingDelta)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
