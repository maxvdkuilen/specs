import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatClock } from '../../shared/algorithms';
import { api } from '../api';
import { secondsUntil, syncServerTime, useNow } from '../clock';
import { StateChip } from '../components/StateChip';
import { useStore } from '../store';
import { useLive } from '../useLive';
import { NotFound } from './NotFound';
import type { ModState } from '../../shared/types';

/** Two taps within 3 seconds to confirm a destructive action. */
function useArmed(timeoutMs = 3000): [boolean, () => boolean, () => void] {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);
  const disarm = useCallback(() => {
    setArmed(false);
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  const tap = useCallback(() => {
    if (armed) {
      disarm();
      return true;
    }
    setArmed(true);
    timer.current = window.setTimeout(() => setArmed(false), timeoutMs);
    return false;
  }, [armed, disarm, timeoutMs]);
  return [armed, tap, disarm];
}

export function Mod() {
  const { boot, refreshBoot } = useStore();
  const isMod = Boolean(boot?.me?.isModerator);
  const live = useLive(isMod);
  const now = useNow(1000);
  const [mod, setMod] = useState<ModState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMod = useCallback(async () => {
    try {
      const m = await api.mod.state();
      syncServerTime(m.serverTime);
      setMod(m);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const liveCount = live.snap?.count;
  const liveState = live.snap?.session?.state;
  const liveSessionId = live.snap?.session?.id;
  useEffect(() => {
    if (!isMod) return;
    void loadMod();
  }, [isMod, loadMod, liveCount, liveState, liveSessionId]);
  useEffect(() => {
    if (!isMod) return;
    const id = window.setInterval(() => void loadMod(), 10_000);
    return () => window.clearInterval(id);
  }, [isMod, loadMod]);

  if (!boot) return <div className="spinner" />;
  if (!isMod) return <NotFound />;
  if (!mod) return error ? <div className="page"><div className="notice danger">{error}</div></div> : <div className="spinner" />;

  const session = mod.session;
  if (!session) return <CreateSession mod={mod} onCreated={loadMod} />;
  if (session.state === 'draft') return <DraftControl mod={mod} onChanged={loadMod} />;

  const count = live.snap && live.snap.session?.id === session.id ? live.snap.count : mod.count;
  return (
    <Counter
      mod={mod}
      count={count}
      now={now}
      connected={live.connected}
      onChanged={async () => {
        await loadMod();
        await refreshBoot();
      }}
    />
  );
}

// ---------------------------------------------------------------------------

function CreateSession({ mod, onCreated }: { mod: ModState; onCreated: () => Promise<void> }) {
  const { boot } = useStore();
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState(Math.round((boot?.config.defaultDurationSec ?? 4500) / 60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.mod.defaults().then((d) => setTitle((t) => t || d.title)).catch(() => undefined);
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.mod.create(title, Math.round(minutes * 60));
      await onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Moderator</div>
        <h1 className="headline">No active session</h1>
        <p className="subtitle">Create today's lecture. Students can pre-submit guesses as soon as it exists.</p>
      </div>
      <form className="card stack" style={{ gap: 16 }} onSubmit={create}>
        <div className="field">
          <label htmlFor="cs-title">Title</label>
          <input id="cs-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="cs-dur">Duration (minutes)</label>
          <input
            id="cs-dur"
            className="input mono"
            type="number"
            inputMode="numeric"
            min={1}
            max={720}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy || !minutes}>
          {busy ? 'Creating…' : 'Create session'}
        </button>
      </form>
      {mod.lastFinished && (
        <div className="card tight stack" style={{ gap: 4 }}>
          <div className="small">Last lecture</div>
          <span style={{ fontWeight: 600 }}>{mod.lastFinished.title}</span>
          <span className="small">
            final count <b className="mono" style={{ color: 'var(--text)' }}>{mod.lastFinished.finalCount ?? '?'}</b> ·{' '}
            {mod.lastFinished.guessCount ?? 0} guesses
          </span>
          <Link to="/leaderboard" className="small">
            Leaderboard →
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DraftControl({ mod, onChanged }: { mod: ModState; onChanged: () => Promise<void> }) {
  const session = mod.session!;
  const [armed, tap, disarm] = useArmed();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { boot } = useStore();
  const lockMin = Math.round((boot?.config.lockAfterSec ?? 600) / 60);

  const start = async () => {
    if (!tap()) return;
    setBusy(true);
    setError(null);
    try {
      await api.mod.start(session.id);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Moderator · draft</div>
        <h1 className="headline">{session.title}</h1>
        <p className="subtitle">
          {Math.round(session.durationSec / 60)} minutes. Guesses lock {lockMin} minutes after you start.{' '}
          <b style={{ color: 'var(--text)' }}>{mod.guessCount}</b> {mod.guessCount === 1 ? 'guess' : 'guesses'} so far.
        </p>
      </div>
      <div className="card stack" style={{ gap: 12 }}>
        <button className={`btn btn-primary big-start${armed ? ' armed' : ''}`} onClick={start} disabled={busy} onBlur={disarm}>
          {busy ? 'Starting…' : armed ? 'Tap again to start' : 'Start lecture'}
        </button>
        <div className="confirm-hint">{armed ? 'Confirm within 3 seconds.' : 'Two taps: the second confirms.'}</div>
        {error && <div className="error center">{error}</div>}
      </div>
      <p className="small center">
        Students see the guess screen at <b>/</b>. Point the QR code there.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface CounterProps {
  mod: ModState;
  count: number;
  now: number;
  connected: boolean;
  onChanged: () => Promise<void>;
}

function Counter({ mod, count, now, connected, onChanged }: CounterProps) {
  const session = mod.session!;
  const [pending, setPending] = useState(0);
  const [flash, setFlash] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [armed, tapEnd, disarm] = useArmed();
  const lastTap = useRef(0);
  const shown = Math.max(0, count + pending);
  const prevShown = useRef(shown);

  useEffect(() => {
    if (prevShown.current === shown) return;
    prevShown.current = shown;
    setPulse(true);
    const id = window.setTimeout(() => setPulse(false), 350);
    return () => window.clearTimeout(id);
  }, [shown]);

  const send = async (delta: 1 | -1) => {
    const t = performance.now();
    if (t - lastTap.current < 300) return; // debounce double taps
    lastTap.current = t;
    if (delta < 0 && shown <= 0) return;
    try {
      navigator.vibrate?.(delta > 0 ? 25 : [15, 40, 15]);
    } catch {
      /* ignore */
    }
    if (delta > 0) {
      setFlash(true);
      window.setTimeout(() => setFlash(false), 80);
    }
    setPending((p) => p + delta);
    setError(null);
    try {
      await api.mod.count(session.id, delta);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      // The websocket carries the authoritative count; drop our optimistic offset.
      setPending((p) => p - delta);
    }
  };

  const end = async () => {
    if (!tapEnd()) return;
    setEnding(true);
    try {
      await api.mod.end(session.id);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnding(false);
    }
  };

  // Hardware volume-up as "+" is not exposed to web pages; keyboard "+" / ArrowUp work on laptops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') void send(1);
      if (e.key === '-' || e.key === 'ArrowDown' || e.key === 'Backspace') void send(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, shown]);

  const toEnd = session.endsAt ? secondsUntil(session.endsAt) : 0;
  const overtime = toEnd <= 0;

  return (
    <div className="mod-screen">
      <div className="mod-top">
        <button className={`btn btn-danger btn-sm${armed ? ' armed' : ''}`} onClick={end} onBlur={disarm} disabled={ending}>
          {ending ? 'Ending…' : armed ? 'Tap again to end' : 'End lecture'}
        </button>
        <span className={`timer${overtime ? ' neg' : ''}`} title="Time left in the lecture">
          {overtime ? `+${formatClock(-toEnd)}` : formatClock(toEnd)}
        </span>
        <button className="mod-minus" onClick={() => void send(-1)} disabled={shown <= 0} aria-label="Undo one">
          −
        </button>
      </div>
      <div className="mod-chip-row">
        <StateChip session={session} now={now} />
      </div>

      {overtime && (
        <div className="notice warn mod-banner center">
          Timer done. End the lecture when {' '}he stops talking.
        </div>
      )}
      {mod.longRunning && <div className="notice danger mod-banner center">This session has been running for over 4 hours.</div>}
      {error && <div className="notice danger mod-banner center">{error}</div>}
      {!connected && <div className="offline">Reconnecting…</div>}

      <div className="mod-mid">
        <div className="eyebrow">
          {session.title} · {mod.guessCount} {mod.guessCount === 1 ? 'guess' : 'guesses'}
        </div>
        <div className={`mod-count${pulse ? ' pulse' : ''}`} aria-live="polite">
          {shown}
        </div>
      </div>

      <div className="mod-log" aria-label="Recent events">
        {mod.recentEvents.length === 0 && <span className="small">No events yet</span>}
        {mod.recentEvents.map((e) => (
          <span key={e.id} className={`ev ${e.delta > 0 ? 'plus' : 'minus'}`} title={e.moderator}>
            {e.delta > 0 ? '+1' : '−1'} {new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        ))}
      </div>

      <button
        className={`mod-plus${flash ? ' flash' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          void send(1);
        }}
        aria-label="Count one glasses removal"
      >
        +
      </button>
    </div>
  );
}
