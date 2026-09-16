/**
 * Session service: state machine, guesses, count events, scoring, snapshots.
 * All time logic uses the server clock. The client never decides lock/end.
 */
import { config } from './config.js';
import { getDb, iso, asDate, num, type Queryable } from './db.js';
import type { Hub } from './realtime.js';
import type { UserRow } from './auth.js';
import { computeRatingUpdates, sessionStats } from '../shared/algorithms.js';
import type {
  CountEventWire,
  LiveSnapshot,
  ModState,
  MyResult,
  SessionInfo,
  SessionState,
  SessionStatsWire,
} from '../shared/types.js';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SessionRow {
  id: number;
  title: string;
  state: SessionState;
  duration_sec: number;
  started_at: unknown;
  locked_at: unknown;
  ends_at: unknown;
  finished_at: unknown;
  scored_at: unknown;
  final_count: number | null;
  guess_count: number | null;
  guess_mean: number | null;
  guess_median: number | null;
  guess_sd: number | null;
  exact_count: number | null;
  within_1sd: number | null;
  within_2sd: number | null;
  created_by: number;
  created_at: unknown;
}

const SESSION_COLS =
  'id, title, state, duration_sec, started_at, locked_at, ends_at, finished_at, scored_at, final_count, ' +
  'guess_count, guess_mean, guess_median, guess_sd, exact_count, within_1sd, within_2sd, created_by, created_at';

let hub: Hub | null = null;
export function setHub(h: Hub): void {
  hub = h;
}

export function toSessionInfo(row: SessionRow): SessionInfo {
  return {
    id: num(row.id),
    title: row.title,
    state: row.state,
    durationSec: num(row.duration_sec),
    startedAt: iso(row.started_at),
    lockedAt: iso(row.locked_at),
    endsAt: iso(row.ends_at),
    finishedAt: iso(row.finished_at),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  };
}

export function statsFromRow(row: SessionRow): SessionStatsWire | null {
  if (row.state !== 'finished' || row.final_count === null || row.final_count === undefined) return null;
  return {
    finalCount: num(row.final_count),
    guessCount: num(row.guess_count),
    guessMean: num(row.guess_mean),
    guessMedian: num(row.guess_median),
    guessSd: num(row.guess_sd),
    exactCount: num(row.exact_count),
    within1Sd: num(row.within_1sd),
    within2Sd: num(row.within_2sd),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getActiveSession(q?: Queryable): Promise<SessionRow | null> {
  const db = q ?? (await getDb());
  const r = await db.query<SessionRow>(
    `SELECT ${SESSION_COLS} FROM sessions WHERE state IN ('draft', 'open', 'locked') ORDER BY id DESC LIMIT 1`,
  );
  return r.rows[0] ?? null;
}

export async function getLastFinishedSession(q?: Queryable): Promise<SessionRow | null> {
  const db = q ?? (await getDb());
  const r = await db.query<SessionRow>(
    `SELECT ${SESSION_COLS} FROM sessions WHERE state = 'finished' ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 1`,
  );
  return r.rows[0] ?? null;
}

/** The session students should see: the active one, else the most recently finished one. */
export async function getCurrentSession(q?: Queryable): Promise<SessionRow | null> {
  return (await getActiveSession(q)) ?? (await getLastFinishedSession(q));
}

export async function getSessionById(id: number, q?: Queryable, forUpdate = false): Promise<SessionRow | null> {
  const db = q ?? (await getDb());
  const r = await db.query<SessionRow>(
    `SELECT ${SESSION_COLS} FROM sessions WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function getCount(q: Queryable, sessionId: number): Promise<number> {
  const r = await q.query<{ c: unknown }>('SELECT COALESCE(SUM(delta), 0)::int AS c FROM count_events WHERE session_id = $1', [
    sessionId,
  ]);
  return num(r.rows[0]?.c);
}

async function getLastEventId(q: Queryable, sessionId: number): Promise<number | null> {
  const r = await q.query<{ id: unknown }>('SELECT MAX(id) AS id FROM count_events WHERE session_id = $1', [sessionId]);
  const v = r.rows[0]?.id;
  return v === null || v === undefined ? null : num(v);
}

export async function getBins(q: Queryable, sessionId: number): Promise<{ bins: number[]; modBins: number[] }> {
  const size = config.guessMax + 1;
  const bins = new Array<number>(size).fill(0);
  const modBins = new Array<number>(size).fill(0);
  const r = await q.query<{ value: unknown; is_moderator: boolean; n: unknown }>(
    `SELECT g.value, u.is_moderator, COUNT(*)::int AS n
       FROM guesses g JOIN users u ON u.id = g.user_id
      WHERE g.session_id = $1
      GROUP BY g.value, u.is_moderator`,
    [sessionId],
  );
  for (const row of r.rows) {
    const v = num(row.value);
    if (v < 0 || v >= size) continue;
    (row.is_moderator ? modBins : bins)[v] += num(row.n);
  }
  return { bins, modBins };
}

async function getPastFinalCounts(q: Queryable, excludeId: number | null): Promise<number[]> {
  const r = await q.query<{ final_count: unknown }>(
    `SELECT final_count FROM sessions WHERE state = 'finished' AND final_count IS NOT NULL AND id <> $1 ORDER BY id`,
    [excludeId ?? -1],
  );
  return r.rows.map((x) => num(x.final_count));
}

async function getMyGuess(q: Queryable, sessionId: number, userId: number | null): Promise<number | null> {
  if (!userId) return null;
  const r = await q.query<{ value: unknown }>('SELECT value FROM guesses WHERE session_id = $1 AND user_id = $2', [
    sessionId,
    userId,
  ]);
  return r.rows.length ? num(r.rows[0].value) : null;
}

/** Whether guesses may be created or edited right now, by the server clock. */
export function canGuessOn(session: SessionRow | null, now = new Date()): boolean {
  if (!session) return false;
  if (session.state === 'draft') return true;
  if (session.state !== 'open') return false;
  const lockedAt = asDate(session.locked_at);
  return !lockedAt || now.getTime() < lockedAt.getTime();
}

async function getMyResult(q: Queryable, session: SessionRow, user: UserRow | null): Promise<MyResult | null> {
  if (!user || session.state !== 'finished' || session.final_count === null) return null;
  const guess = await getMyGuess(q, num(session.id), num(user.id));
  if (guess === null) return null;
  const final = num(session.final_count);
  const base: MyResult = {
    guess,
    error: Math.abs(guess - final),
    rank: null,
    participants: num(session.guess_count),
    ratingBefore: null,
    ratingAfter: null,
  };
  if (user.is_moderator) return base;
  const r = await q.query<{ rank: unknown; rating_before: unknown; rating_after: unknown }>(
    'SELECT rank, rating_before, rating_after FROM rating_history WHERE session_id = $1 AND user_id = $2',
    [session.id, user.id],
  );
  const row = r.rows[0];
  if (!row) return base;
  return { ...base, rank: num(row.rank), ratingBefore: num(row.rating_before), ratingAfter: num(row.rating_after) };
}

export async function buildSnapshot(user: UserRow | null): Promise<LiveSnapshot> {
  const db = await getDb();
  const session = await getCurrentSession(db);
  const now = new Date();
  if (!session) {
    return {
      serverTime: now.getTime(),
      session: null,
      count: 0,
      lastEventId: null,
      bins: new Array<number>(config.guessMax + 1).fill(0),
      modBins: new Array<number>(config.guessMax + 1).fill(0),
      pastFinalCounts: await getPastFinalCounts(db, null),
      myGuess: null,
      canGuess: false,
      stats: null,
      myResult: null,
    };
  }
  const id = num(session.id);
  const [count, lastEventId, { bins, modBins }, pastFinalCounts, myGuess, myResult] = await Promise.all([
    getCount(db, id),
    getLastEventId(db, id),
    getBins(db, id),
    getPastFinalCounts(db, id),
    getMyGuess(db, id, user ? num(user.id) : null),
    getMyResult(db, session, user),
  ]);
  return {
    serverTime: now.getTime(),
    session: toSessionInfo(session),
    count,
    lastEventId,
    bins,
    modBins,
    pastFinalCounts,
    myGuess,
    canGuess: canGuessOn(session, now),
    stats: statsFromRow(session),
    myResult,
  };
}

// ---------------------------------------------------------------------------
// Student writes
// ---------------------------------------------------------------------------

export function parseGuess(raw: unknown): number {
  const v = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < config.guessMin || v > config.guessMax) {
    throw new HttpError(400, `Guess must be a whole number from ${config.guessMin} to ${config.guessMax}.`);
  }
  return v;
}

/** Create or update the user's guess for the active session. Broadcasts the change. */
export async function submitGuess(
  q: Queryable,
  user: UserRow,
  value: number,
): Promise<{ value: number; created: boolean; sessionId: number }> {
  const session = await getActiveSession(q);
  if (!session || !canGuessOn(session)) {
    throw new HttpError(403, 'Guessing is closed for this lecture.');
  }
  const sessionId = num(session.id);
  const existing = await q.query<{ value: unknown }>(
    'SELECT value FROM guesses WHERE session_id = $1 AND user_id = $2 FOR UPDATE',
    [sessionId, user.id],
  );
  const isMod = Boolean(user.is_moderator);
  if (existing.rows.length) {
    const from = num(existing.rows[0].value);
    if (from !== value) {
      await q.query('UPDATE guesses SET value = $3, updated_at = now() WHERE session_id = $1 AND user_id = $2', [
        sessionId,
        user.id,
        value,
      ]);
      hub?.broadcast({ type: 'guess_changed', from, to: value, moderator: isMod });
    }
    return { value, created: false, sessionId };
  }
  await q.query('INSERT INTO guesses (session_id, user_id, value) VALUES ($1, $2, $3)', [sessionId, user.id, value]);
  hub?.broadcast({ type: 'guess_added', value, moderator: isMod });
  return { value, created: true, sessionId };
}

// ---------------------------------------------------------------------------
// Moderator writes
// ---------------------------------------------------------------------------

export function defaultTitle(now = new Date()): string {
  const d = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `Lecture · ${d.replace(',', '')}`;
}

export async function createSession(user: UserRow, title: string | undefined, durationSec: number): Promise<SessionInfo> {
  if (!Number.isInteger(durationSec) || durationSec < 60 || durationSec > 12 * 3600) {
    throw new HttpError(400, 'Duration must be between 1 minute and 12 hours.');
  }
  const db = await getDb();
  if (await getActiveSession(db)) throw new HttpError(409, 'A session is already active.');
  const t = (title ?? '').trim() || defaultTitle();
  const r = await db.query<SessionRow>(
    `INSERT INTO sessions (title, state, duration_sec, created_by) VALUES ($1, 'draft', $2, $3) RETURNING ${SESSION_COLS}`,
    [t.slice(0, 80), durationSec, user.id],
  );
  const info = toSessionInfo(r.rows[0]);
  hub?.broadcast({ type: 'state_changed', session: info, serverTime: Date.now() });
  return info;
}

export async function startSession(sessionId: number): Promise<SessionInfo> {
  const db = await getDb();
  const info = await db.transaction(async (q) => {
    const s = await getSessionById(sessionId, q, true);
    if (!s) throw new HttpError(404, 'Session not found.');
    if (s.state !== 'draft') throw new HttpError(409, `Session is ${s.state}, not draft.`);
    const now = new Date();
    const lockedAt = new Date(now.getTime() + config.lockAfterSec * 1000);
    const endsAt = new Date(now.getTime() + num(s.duration_sec) * 1000);
    const r = await q.query<SessionRow>(
      `UPDATE sessions SET state = 'open', started_at = $2, locked_at = $3, ends_at = $4 WHERE id = $1 RETURNING ${SESSION_COLS}`,
      [sessionId, now, lockedAt, endsAt],
    );
    return toSessionInfo(r.rows[0]);
  });
  hub?.broadcast({ type: 'state_changed', session: info, serverTime: Date.now() });
  return info;
}

export async function addCountEvent(
  user: UserRow,
  sessionId: number,
  delta: number,
): Promise<{ count: number; eventId: number }> {
  if (delta !== 1 && delta !== -1) throw new HttpError(400, 'Delta must be +1 or -1.');
  const db = await getDb();
  const result = await db.transaction(async (q) => {
    const s = await getSessionById(sessionId, q, true);
    if (!s) throw new HttpError(404, 'Session not found.');
    if (s.state !== 'open' && s.state !== 'locked') throw new HttpError(409, 'The lecture is not running.');
    const current = await getCount(q, sessionId);
    if (delta < 0 && current <= 0) throw new HttpError(400, 'Count is already 0.');
    const r = await q.query<{ id: unknown }>(
      'INSERT INTO count_events (session_id, moderator_id, delta) VALUES ($1, $2, $3) RETURNING id',
      [sessionId, user.id, delta],
    );
    return { count: current + delta, eventId: num(r.rows[0].id) };
  });
  hub?.broadcast({ type: 'count_changed', count: result.count, eventId: result.eventId, serverTime: Date.now() });
  return result;
}

/**
 * Score a finished session. Idempotent: the scored_at column is claimed inside the
 * transaction, so a second call (or a concurrent one) does nothing.
 */
export async function scoreSession(q: Queryable, sessionId: number): Promise<boolean> {
  const claim = await q.query<{ final_count: unknown }>(
    `UPDATE sessions SET scored_at = now() WHERE id = $1 AND state = 'finished' AND scored_at IS NULL RETURNING final_count`,
    [sessionId],
  );
  if (claim.rows.length === 0) return false;
  const finalCount = num(claim.rows[0].final_count);

  const parts = await q.query<{ user_id: unknown; value: unknown; rating: unknown; sessions_played: unknown }>(
    `SELECT g.user_id, g.value, u.rating, u.sessions_played
       FROM guesses g JOIN users u ON u.id = g.user_id
      WHERE g.session_id = $1 AND u.is_moderator = false
      ORDER BY g.user_id`,
    [sessionId],
  );
  const participants = parts.rows.map((p) => ({
    userId: num(p.user_id),
    guess: num(p.value),
    rating: num(p.rating),
    sessionsPlayed: num(p.sessions_played),
  }));
  const stats = sessionStats(
    participants.map((p) => p.guess),
    finalCount,
  );
  const updates = computeRatingUpdates(participants, finalCount, {
    kNew: config.eloKNew,
    k: config.eloK,
    newSessions: config.eloNewSessions,
  });
  for (const u of updates) {
    await q.query('UPDATE users SET rating = $2, sessions_played = sessions_played + 1 WHERE id = $1', [
      u.userId,
      u.ratingAfter,
    ]);
    await q.query(
      `INSERT INTO rating_history (session_id, user_id, rating_before, rating_after, rank, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, u.userId, u.ratingBefore, u.ratingAfter, u.rank, u.error],
    );
  }
  await q.query(
    `UPDATE sessions SET guess_count = $2, guess_mean = $3, guess_median = $4, guess_sd = $5,
            exact_count = $6, within_1sd = $7, within_2sd = $8 WHERE id = $1`,
    [
      sessionId,
      stats.guessCount,
      stats.guessMean,
      stats.guessMedian,
      stats.guessSd,
      stats.exactCount,
      stats.within1Sd,
      stats.within2Sd,
    ],
  );
  return true;
}

export async function endSession(sessionId: number): Promise<{ session: SessionInfo; stats: SessionStatsWire }> {
  const db = await getDb();
  const out = await db.transaction(async (q) => {
    const s = await getSessionById(sessionId, q, true);
    if (!s) throw new HttpError(404, 'Session not found.');
    if (s.state !== 'open' && s.state !== 'locked') throw new HttpError(409, 'The lecture is not running.');
    const count = await getCount(q, sessionId);
    await q.query(`UPDATE sessions SET state = 'finished', finished_at = $2, final_count = $3 WHERE id = $1`, [
      sessionId,
      new Date(),
      count,
    ]);
    await scoreSession(q, sessionId);
    const fresh = await getSessionById(sessionId, q);
    if (!fresh) throw new HttpError(500, 'Session vanished.');
    return { session: toSessionInfo(fresh), stats: statsFromRow(fresh)! };
  });
  hub?.broadcast({ type: 'session_finished', session: out.session, stats: out.stats, serverTime: Date.now() });
  return out;
}

/** Re-run scoring for a finished session. Returns false if it was already scored. */
export async function rescoreSession(sessionId: number): Promise<boolean> {
  const db = await getDb();
  return db.transaction((q) => scoreSession(q, sessionId));
}

// ---------------------------------------------------------------------------
// Lock transition (server clock) and ticker
// ---------------------------------------------------------------------------

export async function applyLockTransition(): Promise<void> {
  const db = await getDb();
  const r = await db.query<SessionRow>(
    `UPDATE sessions SET state = 'locked' WHERE state = 'open' AND locked_at IS NOT NULL AND locked_at <= $1 RETURNING ${SESSION_COLS}`,
    [new Date()],
  );
  for (const row of r.rows) {
    hub?.broadcast({ type: 'state_changed', session: toSessionInfo(row), serverTime: Date.now() });
  }
}

export function startTicker(): NodeJS.Timeout {
  return setInterval(() => {
    applyLockTransition().catch((err) => console.error('[tick] lock transition failed', err));
  }, 1000);
}

// ---------------------------------------------------------------------------
// Moderator state
// ---------------------------------------------------------------------------

export async function getModState(): Promise<ModState> {
  const db = await getDb();
  const session = await getActiveSession(db);
  const last = await getLastFinishedSession(db);
  const now = Date.now();
  const lastFinished = last
    ? { ...toSessionInfo(last), finalCount: last.final_count === null ? null : num(last.final_count), guessCount: last.guess_count === null ? null : num(last.guess_count) }
    : null;
  if (!session) {
    return { serverTime: now, session: null, count: 0, recentEvents: [], guessCount: 0, longRunning: false, lastFinished };
  }
  const id = num(session.id);
  const [count, events, guesses] = await Promise.all([
    getCount(db, id),
    db.query<{ id: unknown; delta: unknown; created_at: unknown; username: string }>(
      `SELECT e.id, e.delta, e.created_at, u.username
         FROM count_events e JOIN users u ON u.id = e.moderator_id
        WHERE e.session_id = $1 ORDER BY e.id DESC LIMIT 5`,
      [id],
    ),
    db.query<{ n: unknown }>('SELECT COUNT(*)::int AS n FROM guesses WHERE session_id = $1', [id]),
  ]);
  const startedAt = asDate(session.started_at);
  const recentEvents: CountEventWire[] = events.rows.map((e) => ({
    id: num(e.id),
    delta: num(e.delta),
    createdAt: iso(e.created_at) ?? '',
    moderator: e.username,
  }));
  return {
    serverTime: now,
    session: toSessionInfo(session),
    count,
    recentEvents,
    guessCount: num(guesses.rows[0]?.n),
    longRunning: Boolean(startedAt && now - startedAt.getTime() > config.longRunningSec * 1000),
    lastFinished,
  };
}
