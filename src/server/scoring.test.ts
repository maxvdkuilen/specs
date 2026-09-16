/**
 * Integration test against an in-memory PGlite: ending a session scores it exactly once.
 */
import { beforeAll, describe, expect, it } from 'vitest';

process.env.PGLITE_DIR = 'memory://';
process.env.DATABASE_URL = '';

const { getDb } = await import('./db.js');
const { ensureSchema } = await import('./schema.js');
const { endSession, getBins, getCount, rescoreSession, startSession, submitGuess, addCountEvent, createSession, canGuessOn, getActiveSession } =
  await import('./sessions.js');
import type { UserRow } from './auth.js';

async function mkUser(username: string, isMod = false): Promise<UserRow> {
  const db = await getDb();
  const r = await db.query<UserRow>(
    `INSERT INTO users (username, password_hash, is_moderator) VALUES ($1, 'x', $2)
     RETURNING id, username, password_hash, is_moderator, rating, sessions_played`,
    [username, isMod],
  );
  return r.rows[0];
}

describe('session lifecycle and scoring', () => {
  let mod: UserRow;
  let a: UserRow;
  let b: UserRow;
  let c: UserRow;

  beforeAll(async () => {
    const db = await getDb();
    await ensureSchema(db);
    mod = await mkUser('mod', true);
    a = await mkUser('a');
    b = await mkUser('b');
    c = await mkUser('c');
  });

  it('runs draft -> open -> finished and scores once', async () => {
    const db = await getDb();
    const session = await createSession(mod, 'Test', 600);
    expect(session.state).toBe('draft');

    await db.transaction((q) => submitGuess(q, a, 10));
    await db.transaction((q) => submitGuess(q, b, 12));
    await db.transaction((q) => submitGuess(q, c, 20));
    await db.transaction((q) => submitGuess(q, mod, 10)); // moderator: shown, not scored
    await db.transaction((q) => submitGuess(q, c, 19)); // edit

    const bins = await getBins(db, session.id);
    expect(bins.bins[10]).toBe(1);
    expect(bins.bins[19]).toBe(1);
    expect(bins.bins[20]).toBe(0);
    expect(bins.modBins[10]).toBe(1);

    await startSession(session.id);
    for (let i = 0; i < 11; i++) await addCountEvent(mod, session.id, 1);
    await addCountEvent(mod, session.id, -1);
    expect(await getCount(db, session.id)).toBe(10);

    const ended = await endSession(session.id);
    expect(ended.session.state).toBe('finished');
    expect(ended.stats.finalCount).toBe(10);
    expect(ended.stats.guessCount).toBe(3);
    expect(ended.stats.exactCount).toBe(1);

    const ratings = async () =>
      (await db.query<{ username: string; rating: number; sessions_played: number }>(
        'SELECT username, rating, sessions_played FROM users ORDER BY username',
      )).rows.map((r) => [r.username, Number(r.rating), Number(r.sessions_played)]);

    const after = await ratings();
    expect(after).toEqual([
      ['a', 1024, 1],
      ['b', 1000, 1],
      ['c', 976, 1],
      ['mod', 1000, 0],
    ]);

    // Scoring twice must be a no-op.
    expect(await rescoreSession(session.id)).toBe(false);
    expect(await ratings()).toEqual(after);
    const hist = await db.query<{ n: unknown }>('SELECT COUNT(*)::int AS n FROM rating_history WHERE session_id = $1', [session.id]);
    expect(Number(hist.rows[0].n)).toBe(3);
  });

  it('rejects guesses once locked_at has passed, by the server clock', async () => {
    const db = await getDb();
    const s = await createSession(mod, 'Lock test', 600);
    await startSession(s.id);
    await db.query('UPDATE sessions SET locked_at = now() - interval \'1 second\' WHERE id = $1', [s.id]);
    const row = await getActiveSession(db);
    expect(canGuessOn(row)).toBe(false);
    await expect(db.transaction((q) => submitGuess(q, a, 5))).rejects.toThrow(/closed/);
    await expect(addCountEvent(mod, s.id, -1)).rejects.toThrow(/already 0/);
    await endSession(s.id);
  });
});
