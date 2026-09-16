import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ordinal } from '../../shared/algorithms';
import { api } from '../api';
import { useStore } from '../store';
import type { ProfileResponse } from '../../shared/types';

export function Me() {
  const { boot, setMe, refreshBoot } = useStore();
  const navigate = useNavigate();
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!boot?.me) return;
    api.me().then(setData).catch((e) => setError((e as Error).message));
  }, [boot?.me]);

  if (!boot) return <div className="spinner" />;
  if (!boot.me) return <Navigate to="/login" replace />;

  const logout = async () => {
    await api.logout();
    setMe(null);
    await refreshBoot();
    navigate('/', { replace: true });
  };

  const me = data?.me ?? boot.me;

  return (
    <div className="page">
      <div className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">{me.isModerator ? 'Moderator' : 'Profile'}</div>
        <h1 className="headline">{me.username}</h1>
      </div>

      <div className="card row" style={{ gap: 24 }}>
        <div className="big-stat">
          <span className="small">Rating</span>
          <span className="v">{me.rating}</span>
        </div>
        <div className="big-stat">
          <span className="small">Lectures</span>
          <span className="v">{me.sessionsPlayed}</span>
        </div>
        {me.isModerator && (
          <Link to="/mod" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>
            Mod panel
          </Link>
        )}
      </div>

      {me.isModerator && <p className="small">Moderator guesses show in the histogram but are not scored or ranked.</p>}

      <div className="stack">
        <h2 className="title">History</h2>
        {error && <div className="error">{error}</div>}
        {!data && !error && <div className="spinner" />}
        {data && data.history.length === 0 && <div className="empty">No finished lectures yet.</div>}
        {data?.history.map((h) => {
          const delta = h.ratingAfter !== null && h.ratingBefore !== null ? h.ratingAfter - h.ratingBefore : null;
          return (
            <div className="hist-row" key={h.sessionId}>
              <span className="t">{h.title}</span>
              <span className={`delta ${delta === null ? 'dim' : delta >= 0 ? 'pos' : 'neg'}`}>
                {delta === null ? '—' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}`}
              </span>
              <span className="d">
                guessed <b>{h.guess}</b>, final <b>{h.finalCount ?? '?'}</b>
                {h.error !== null && <>, off by {h.error}</>}
                {h.rank !== null && h.participants ? <>, {ordinal(h.rank)} of {h.participants}</> : null}
              </span>
              <span className="d" style={{ textAlign: 'right' }}>
                {h.ratingAfter !== null ? `→ ${h.ratingAfter}` : ''}
              </span>
            </div>
          );
        })}
      </div>

      <button className="btn btn-ghost" onClick={logout}>
        Log out
      </button>
    </div>
  );
}
