import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { binsToValues, formatClock, median, priorRate, projectFinal } from '../../shared/algorithms';
import { api } from '../api';
import { secondsUntil, serverNow, useNow } from '../clock';
import { CountDisplay } from '../components/CountDisplay';
import { Histogram } from '../components/Histogram';
import { NumberInput } from '../components/NumberInput';
import { ResultsModal } from '../components/ResultsModal';
import { StateChip, describeState } from '../components/StateChip';
import { useStore } from '../store';
import { useLive } from '../useLive';

const SEEN_KEY = 'specs.seenResults';

export function Live() {
  const { boot, refreshBoot } = useStore();
  const live = useLive(true);
  const now = useNow(1000);
  const [showResults, setShowResults] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const snap = live.snap;
  const session = snap?.session ?? null;

  // Auto-open the results modal once per finished session.
  useEffect(() => {
    if (!session || session.state !== 'finished' || !snap?.stats || snap.myGuess === null) return;
    let seen: number | null = null;
    try {
      seen = Number(localStorage.getItem(SEEN_KEY));
    } catch {
      /* ignore */
    }
    if (seen !== session.id) {
      setShowResults(true);
      try {
        localStorage.setItem(SEEN_KEY, String(session.id));
      } catch {
        /* ignore */
      }
    }
  }, [session, snap?.stats, snap?.myGuess, live.finishedTick]);

  useEffect(() => {
    if (live.finishedTick > 0) void refreshBoot();
  }, [live.finishedTick, refreshBoot]);

  const derived = useMemo(() => {
    if (!snap || !session || !boot) return null;
    const st = describeState(session, now);
    const hasCount = session.state !== 'draft';
    const elapsed = session.startedAt ? (serverNow() - new Date(session.startedAt).getTime()) / 1000 : 0;
    const allBins = snap.bins.map((n, i) => n + (snap.modBins[i] ?? 0));
    const guesses = binsToValues(allBins);
    let projected: number | null = null;
    if ((session.state === 'open' || session.state === 'locked') && elapsed >= boot.config.projectionMinElapsedSec) {
      const elapsedQ = Math.floor(elapsed / 15) * 15; // recompute every 15 s (and on every count change)
      projected = projectFinal({
        count: snap.count,
        elapsedSec: elapsedQ,
        durationSec: session.durationSec,
        priorRate: priorRate(snap.pastFinalCounts, guesses, session.durationSec),
        tauSec: boot.config.projectionTauSec,
      });
    }
    const toEnd = session.endsAt ? secondsUntil(session.endsAt) : null;
    return { st, hasCount, projected, toEnd, total: guesses.length, med: median(guesses), allBins };
  }, [snap, session, boot, now]);

  if (!boot) return <div className="spinner" />;
  if (!snap) return <div className="spinner" />;
  if (!session) return <Navigate to="/" replace />;
  if (snap.myGuess === null) return <Navigate to="/" replace />;
  if (!derived) return <div className="spinner" />;

  const canEdit = snap.canGuess && derived.st.effective !== 'locked' && session.state !== 'finished';

  const saveEdit = async () => {
    if (editValue === null) return;
    setBusy(true);
    setEditError(null);
    try {
      await api.guess(editValue);
      live.setMyGuess(editValue);
      setEditing(false);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      {!live.connected && <div className="offline">Reconnecting…</div>}

      <div className="live-header">
        <div className="stack" style={{ gap: 6 }}>
          <div className="title">{session.title}</div>
          <StateChip session={session} now={now} />
        </div>
        <div className="timer" title="Time left in the lecture">
          {session.state === 'finished'
            ? 'done'
            : derived.toEnd === null
              ? '–:––'
              : derived.toEnd <= 0
                ? 'overtime'
                : formatClock(derived.toEnd)}
        </div>
      </div>

      <CountDisplay
        count={snap.count}
        hasCount={derived.hasCount}
        label={session.state === 'finished' ? 'final count' : 'glasses off so far'}
      />

      <div className="card" style={{ padding: '8px 10px 4px' }}>
        <Histogram
          bins={derived.allBins}
          count={snap.count}
          hasCount={derived.hasCount}
          myGuess={snap.myGuess}
          projected={derived.projected}
        />
      </div>

      <div className="footer-stats">
        <span>
          <b>{derived.total}</b> {derived.total === 1 ? 'guess' : 'guesses'}
        </span>
        <span>·</span>
        <span>
          median <b>{derived.total ? derived.med : '–'}</b>
        </span>
        <span>·</span>
        <span>
          your guess <b className="cyan">{snap.myGuess}</b>
          {canEdit && !editing && (
            <>
              {' '}
              ·{' '}
              <button
                className="link-btn"
                style={{ minHeight: 0, fontSize: 14 }}
                onClick={() => {
                  setEditValue(snap.myGuess);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            </>
          )}
        </span>
      </div>

      {editing && canEdit && (
        <div className="card stack" style={{ gap: 14 }}>
          <div className="row between">
            <div className="title" style={{ fontSize: 16 }}>
              Change your guess
            </div>
            <span className="small">locks in {formatClock(secondsUntil(session.lockedAt))}</span>
          </div>
          <NumberInput value={editValue} onChange={setEditValue} min={boot.config.guessMin} max={boot.config.guessMax} />
          {editError && <div className="error">{editError}</div>}
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={saveEdit} disabled={busy || editValue === null}>
              Save
            </button>
          </div>
        </div>
      )}

      {session.state === 'finished' && snap.stats && (
        <button className="btn btn-ghost" onClick={() => setShowResults(true)}>
          See results
        </button>
      )}

      {session.state === 'draft' && (
        <p className="small center">The count starts when the moderator starts the lecture. Bars turn green near the live count.</p>
      )}

      <p className="small center">
        <Link to="/leaderboard">Leaderboard</Link>
      </p>

      {showResults && snap.stats && (
        <ResultsModal
          stats={snap.stats}
          myResult={snap.myResult}
          isModerator={Boolean(boot.me?.isModerator)}
          onClose={() => setShowResults(false)}
        />
      )}
    </div>
  );
}
