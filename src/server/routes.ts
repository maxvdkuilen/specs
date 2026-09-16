import { Router, type Request, type Response, type NextFunction } from 'express';
import { config, publicConfig } from './config.js';
import { getDb, iso, num } from './db.js';
import {
  clearSessionCookie,
  findUserByUsername,
  hashPassword,
  requireModerator,
  requireUser,
  setSessionCookie,
  toMe,
  validatePassword,
  validateUsername,
  verifyPassword,
  type UserRow,
} from './auth.js';
import { RateLimiter, clientIp, rateLimitMiddleware } from './ratelimit.js';
import {
  HttpError,
  addCountEvent,
  buildSnapshot,
  canGuessOn,
  createSession,
  defaultTitle,
  endSession,
  getActiveSession,
  getCurrentSession,
  getLastFinishedSession,
  getModState,
  parseGuess,
  startSession,
  submitGuess,
  toSessionInfo,
} from './sessions.js';
import type {
  Bootstrap,
  LeaderboardResponse,
  LeaderboardRow,
  ProfileHistoryRow,
  ProfileResponse,
  SessionRankingRow,
} from '../shared/types.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const signupLimiter = new RateLimiter(config.signupPerIpPerHour, 60 * 60 * 1000);
const loginIpLimiter = new RateLimiter(config.loginPerIpPer15Min, 15 * 60 * 1000);
const loginUserLimiter = new RateLimiter(10, 15 * 60 * 1000);
setInterval(() => {
  signupLimiter.sweep();
  loginIpLimiter.sweep();
  loginUserLimiter.sweep();
}, 10 * 60 * 1000).unref();

export const api = Router();

// ---------------------------------------------------------------------------
// Bootstrap / auth
// ---------------------------------------------------------------------------

api.get(
  '/bootstrap',
  wrap(async (req, res) => {
    const db = await getDb();
    const session = await getCurrentSession(db);
    let myGuess: number | null = null;
    if (session && req.user) {
      const r = await db.query<{ value: unknown }>('SELECT value FROM guesses WHERE session_id = $1 AND user_id = $2', [
        session.id,
        req.user.id,
      ]);
      myGuess = r.rows.length ? num(r.rows[0].value) : null;
    }
    const body: Bootstrap = {
      serverTime: Date.now(),
      config: publicConfig(),
      me: req.user ? toMe(req.user) : null,
      session: session ? toSessionInfo(session) : null,
      myGuess,
      canGuess: canGuessOn(session),
    };
    res.json(body);
  }),
);

/** Attempts to submit a pending guess; returns a user-facing note instead of failing the login/signup. */
async function tryPendingGuess(user: UserRow, raw: unknown): Promise<{ guess: number | null; guessError: string | null }> {
  if (raw === undefined || raw === null || raw === '') return { guess: null, guessError: null };
  try {
    const value = parseGuess(raw);
    const db = await getDb();
    const out = await db.transaction((q) => submitGuess(q, user, value));
    return { guess: out.value, guessError: null };
  } catch (err) {
    if (err instanceof HttpError) return { guess: null, guessError: err.message };
    throw err;
  }
}

api.post(
  '/signup',
  rateLimitMiddleware(signupLimiter, 'Too many accounts created from this network. Try again later.'),
  wrap(async (req, res) => {
    const { username, password, guess } = (req.body ?? {}) as Record<string, unknown>;
    const uErr = validateUsername(username);
    if (uErr) throw new HttpError(400, uErr, 'username');
    const pErr = validatePassword(password);
    if (pErr) throw new HttpError(400, pErr, 'password');
    if (guess !== undefined && guess !== null && guess !== '') parseGuess(guess);

    const db = await getDb();
    if (await findUserByUsername(username as string)) throw new HttpError(409, 'That username is taken. Try another.', 'username');
    const passwordHash = await hashPassword(password as string);

    // User and guess are created in one transaction so the guess is never lost.
    const result = await db.transaction(async (q) => {
      let created: UserRow;
      try {
        const r = await q.query<UserRow>(
          `INSERT INTO users (username, password_hash) VALUES ($1, $2)
           RETURNING id, username, password_hash, is_moderator, rating, sessions_played`,
          [username, passwordHash],
        );
        created = r.rows[0];
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, 'That username is taken. Try another.', 'username');
        throw err;
      }
      let guessValue: number | null = null;
      let guessError: string | null = null;
      if (guess !== undefined && guess !== null && guess !== '') {
        try {
          guessValue = (await submitGuess(q, created, parseGuess(guess))).value;
        } catch (err) {
          if (err instanceof HttpError) guessError = err.message;
          else throw err;
        }
      }
      return { user: created, guessValue, guessError };
    });

    setSessionCookie(res, num(result.user.id));
    res.status(201).json({ me: toMe(result.user), guess: result.guessValue, guessError: result.guessError });
  }),
);

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === '23505' || /unique|duplicate key/i.test(e?.message ?? '');
}

api.post(
  '/login',
  rateLimitMiddleware(loginIpLimiter, 'Too many login attempts. Try again in a few minutes.'),
  wrap(async (req, res) => {
    const { username, password, guess } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Username and password are required.');
    if (!loginUserLimiter.hit(username.toLowerCase())) {
      throw new HttpError(429, 'Too many login attempts for this account. Try again in a few minutes.');
    }
    const user = await findUserByUsername(username);
    if (!user) throw new HttpError(401, 'No account with that username. Check the spelling, or create an account.', 'username');
    if (!(await verifyPassword(password, user.password_hash))) throw new HttpError(401, 'Wrong password for this username.', 'password');
    setSessionCookie(res, num(user.id));
    const pending = await tryPendingGuess(user, guess);
    res.json({ me: toMe(user), ...pending });
  }),
);

api.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Guesses and live state
// ---------------------------------------------------------------------------

api.put(
  '/guess',
  requireUser,
  wrap(async (req, res) => {
    const value = parseGuess((req.body ?? {}).value);
    const db = await getDb();
    const out = await db.transaction((q) => submitGuess(q, req.user!, value));
    res.json(out);
  }),
);

api.get(
  '/live',
  wrap(async (req, res) => {
    res.json(await buildSnapshot(req.user));
  }),
);

// ---------------------------------------------------------------------------
// Leaderboard and profile
// ---------------------------------------------------------------------------

api.get(
  '/leaderboard',
  wrap(async (req, res) => {
    const db = await getDb();
    const meId = req.user ? num(req.user.id) : null;

    const users = await db.query<{ id: unknown; username: string; rating: unknown; sessions_played: unknown }>(
      `SELECT id, username, rating, sessions_played FROM users
        WHERE is_moderator = false AND sessions_played > 0
        ORDER BY rating DESC, sessions_played DESC, lower(username)`,
    );
    const history = await db.query<{ user_id: unknown; rating_before: unknown; rating_after: unknown }>(
      `SELECT h.user_id, h.rating_before, h.rating_after FROM rating_history h
         JOIN users u ON u.id = h.user_id WHERE u.is_moderator = false ORDER BY h.id`,
    );
    const byUser = new Map<number, { deltas: number[]; spark: number[] }>();
    for (const h of history.rows) {
      const id = num(h.user_id);
      const entry = byUser.get(id) ?? { deltas: [], spark: [] };
      entry.deltas.push(num(h.rating_after) - num(h.rating_before));
      entry.spark.push(num(h.rating_after));
      byUser.set(id, entry);
    }
    const season: LeaderboardRow[] = users.rows.map((u, i) => {
      const id = num(u.id);
      const h = byUser.get(id);
      const played = num(u.sessions_played);
      return {
        rank: i + 1,
        userId: id,
        username: u.username,
        rating: num(u.rating),
        sessionsPlayed: played,
        provisional: played < 3,
        lastDelta: h && h.deltas.length ? h.deltas[h.deltas.length - 1] : null,
        spark: h ? [config.eloStart, ...h.spark].slice(-8) : [],
        isMe: meId === id,
      };
    });
    const me = season.find((r) => r.isMe) ?? null;

    let lecture: LeaderboardResponse['lecture'] = null;
    const last = await getLastFinishedSession(db);
    if (last && last.final_count !== null) {
      const finalCount = num(last.final_count);
      const rows = await db.query<{
        user_id: unknown;
        username: string;
        value: unknown;
        rating_before: unknown;
        rating_after: unknown;
      }>(
        `SELECT u.id AS user_id, u.username, g.value, h.rating_before, h.rating_after
           FROM guesses g
           JOIN users u ON u.id = g.user_id
           LEFT JOIN rating_history h ON h.session_id = g.session_id AND h.user_id = g.user_id
          WHERE g.session_id = $1 AND u.is_moderator = false
          ORDER BY ABS(g.value - $2), g.updated_at, g.id`,
        [last.id, finalCount],
      );
      const ranking: SessionRankingRow[] = rows.rows.map((r, i) => ({
        rank: i + 1,
        username: r.username,
        guess: num(r.value),
        error: Math.abs(num(r.value) - finalCount),
        ratingDelta: r.rating_after === null || r.rating_after === undefined ? null : num(r.rating_after) - num(r.rating_before),
        isMe: meId === num(r.user_id),
      }));
      lecture = { session: toSessionInfo(last), finalCount, rows: ranking };
    }

    const body: LeaderboardResponse = { season, me, lecture };
    res.json(body);
  }),
);

api.get(
  '/me',
  requireUser,
  wrap(async (req, res) => {
    const db = await getDb();
    const rows = await db.query<{
      id: unknown;
      title: string;
      finished_at: unknown;
      final_count: unknown;
      guess_count: unknown;
      value: unknown;
      rating_before: unknown;
      rating_after: unknown;
      rank: unknown;
      error: unknown;
    }>(
      `SELECT s.id, s.title, s.finished_at, s.final_count, s.guess_count, g.value,
              h.rating_before, h.rating_after, h.rank, h.error
         FROM guesses g
         JOIN sessions s ON s.id = g.session_id
         LEFT JOIN rating_history h ON h.session_id = g.session_id AND h.user_id = g.user_id
        WHERE g.user_id = $1 AND s.state = 'finished'
        ORDER BY s.finished_at DESC, s.id DESC`,
      [req.user!.id],
    );
    const history: ProfileHistoryRow[] = rows.rows.map((r) => {
      const finalCount = r.final_count === null || r.final_count === undefined ? null : num(r.final_count);
      const guess = num(r.value);
      const scored = r.rating_after !== null && r.rating_after !== undefined;
      return {
        sessionId: num(r.id),
        title: r.title,
        finishedAt: iso(r.finished_at),
        guess,
        finalCount,
        error: finalCount === null ? null : Math.abs(guess - finalCount),
        ratingBefore: scored ? num(r.rating_before) : null,
        ratingAfter: scored ? num(r.rating_after) : null,
        rank: scored ? num(r.rank) : null,
        participants: r.guess_count === null || r.guess_count === undefined ? null : num(r.guess_count),
      };
    });
    const body: ProfileResponse = { me: toMe(req.user!), history };
    res.json(body);
  }),
);

// ---------------------------------------------------------------------------
// Moderator
// ---------------------------------------------------------------------------

const mod = Router();
mod.use(requireModerator);

mod.get(
  '/state',
  wrap(async (_req, res) => {
    res.json(await getModState());
  }),
);

mod.get('/defaults', (_req, res) => {
  res.json({ title: defaultTitle(), durationSec: config.defaultDurationSec });
});

mod.post(
  '/sessions',
  wrap(async (req, res) => {
    const { title, durationSec } = (req.body ?? {}) as { title?: string; durationSec?: number };
    const dur = durationSec === undefined ? config.defaultDurationSec : Number(durationSec);
    const session = await createSession(req.user!, typeof title === 'string' ? title : undefined, dur);
    res.status(201).json({ session });
  }),
);

function sessionIdParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Bad session id.');
  return id;
}

mod.post(
  '/sessions/:id/start',
  wrap(async (req, res) => {
    res.json({ session: await startSession(sessionIdParam(req)) });
  }),
);

mod.post(
  '/sessions/:id/count',
  wrap(async (req, res) => {
    const delta = Number((req.body ?? {}).delta);
    res.json(await addCountEvent(req.user!, sessionIdParam(req), delta));
  }),
);

mod.post(
  '/sessions/:id/end',
  wrap(async (req, res) => {
    res.json(await endSession(sessionIdParam(req)));
  }),
);

/** Convenience for the moderator: the active session id without knowing it up front. */
mod.get(
  '/active',
  wrap(async (_req, res) => {
    const s = await getActiveSession();
    res.json({ session: s ? toSessionInfo(s) : null });
  }),
);

api.use('/mod', mod);

api.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
api.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, field: err.field ?? undefined });
    return;
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.parse.failed' || e?.status === 400) {
    res.status(400).json({ error: 'Bad request.' });
    return;
  }
  console.error(`[api] ${req.method} ${req.path} from ${clientIp(req)}:`, err);
  res.status(500).json({ error: 'Something went wrong.' });
});
