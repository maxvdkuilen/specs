import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { formatClock } from '../../shared/algorithms';
import { api } from '../api';
import { secondsUntil, useNow } from '../clock';
import { LeaderboardView } from '../components/LeaderboardView';
import { NumberInput } from '../components/NumberInput';
import { useStore } from '../store';
import { useLive } from '../useLive';

export function Landing() {
  const { boot, bootError, pendingGuess, setPendingGuess, refreshBoot } = useStore();
  const navigate = useNavigate();
  const now = useNow(1000);
  const [value, setValue] = useState<number | null>(pendingGuess);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stay in sync with the server: refetch the overview on arrival and whenever the session changes
  // (a moderator creating, starting or ending a lecture while students sit on this page).
  const live = useLive(true);
  const liveSessionId = live.snap?.session?.id ?? null;
  const liveState = live.snap?.session?.state ?? null;
  useEffect(() => {
    void refreshBoot();
  }, [refreshBoot, liveSessionId, liveState]);

  if (bootError) return <div className="page"><div className="notice danger">{bootError}</div></div>;
  if (!boot) return <div className="spinner" />;

  const { session, config, me } = boot;
  const active = session && session.state !== 'finished';
  const toLock = session?.lockedAt ? secondsUntil(session.lockedAt) : null;
  const guessable = Boolean(active && boot.canGuess && (session!.state === 'draft' || toLock === null || toLock > 0));

  if (active && me && boot.myGuess !== null) return <Navigate to="/live" replace />;

  const submit = async () => {
    if (value === null) return setError('Pick a number first.');
    setError(null);
    if (!me) {
      setPendingGuess(value);
      navigate('/signup');
      return;
    }
    setBusy(true);
    try {
      await api.guess(value);
      setPendingGuess(null);
      await refreshBoot();
      navigate('/live');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (active && guessable) {
    return (
      <div className="page">
        <div className="stack" style={{ gap: 8 }}>
          <div className="eyebrow">
            {config.className} · {session!.title}
          </div>
          <h1 className="headline">
            How many times will {config.professorName} take off his glasses during today's lecture?
          </h1>
        </div>

        <form
          className="card stack"
          style={{ gap: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <NumberInput value={value} onChange={setValue} min={config.guessMin} max={config.guessMax} />
          <p className="small center">
            {session!.state === 'open' && toLock !== null ? (
              <>
                Guesses lock in <b className="mono" style={{ color: 'var(--yellow)' }}>{formatClock(toLock)}</b>.
              </>
            ) : (
              <>Guesses lock {Math.round(config.lockAfterSec / 60)} minutes into lecture.</>
            )}
          </p>
          {error && <div className="error center">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy || value === null}>
            {busy ? 'Locking in…' : 'Lock it in'}
          </button>
        </form>

        {!me && (
          <p className="small center">
            Already have an account? <Link to="/login">Log in</Link>
          </p>
        )}
        <span aria-hidden="true" hidden>
          {now}
        </span>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">{config.className}</div>
        {active ? (
          <>
            <h1 className="headline">Guessing has closed for this lecture.</h1>
            <p className="subtitle">Come back next time, and be quick: guesses lock {Math.round(config.lockAfterSec / 60)} minutes in.</p>
          </>
        ) : (
          <>
            <h1 className="headline">No lecture today.</h1>
            <p className="subtitle">
              When the next lecture opens, guess how many times {config.professorName} takes off his glasses. Then watch it happen live.
            </p>
          </>
        )}
      </div>

      {!active && session && me && boot.myGuess !== null && (
        <Link to="/live" className="card tight row between" style={{ color: 'var(--text)' }}>
          <span>
            <div className="small">Last lecture</div>
            <div style={{ fontWeight: 600 }}>{session.title}</div>
          </span>
          <span className="cyan" style={{ fontWeight: 600 }}>
            See results →
          </span>
        </Link>
      )}

      <div className="stack">
        <div className="row between">
          <h2 className="title">Leaderboard</h2>
          <Link to="/leaderboard" className="small">
            Full board →
          </Link>
        </div>
        <LeaderboardView compact />
      </div>

      {!me && (
        <p className="small center">
          <Link to="/login">Log in</Link>
        </p>
      )}
    </div>
  );
}
