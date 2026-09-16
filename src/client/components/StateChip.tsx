import { formatClock } from '../../shared/algorithms';
import { secondsUntil } from '../clock';
import type { SessionInfo } from '../../shared/types';

/** Text + class for the session state chip. `now` forces re-render from useNow. */
export function describeState(session: SessionInfo | null, _now: number): { cls: string; text: string; effective: string } {
  if (!session) return { cls: 'draft', text: 'No lecture', effective: 'none' };
  if (session.state === 'finished') return { cls: 'finished', text: 'Finished', effective: 'finished' };
  if (session.state === 'draft') return { cls: 'draft', text: 'Starts soon · guessing open', effective: 'draft' };
  const toLock = secondsUntil(session.lockedAt);
  if (session.state === 'locked' || toLock <= 0) return { cls: 'locked', text: 'Locked', effective: 'locked' };
  return { cls: 'open', text: `Guessing open · locks in ${formatClock(toLock)}`, effective: 'open' };
}

export function StateChip({ session, now }: { session: SessionInfo | null; now: number }) {
  const d = describeState(session, now);
  return (
    <span className={`chip ${d.cls}`}>
      <span className="dot" />
      {d.text}
    </span>
  );
}
