/**
 * Seed: 3 moderators, 40 fake students, one finished lecture with realistic guesses,
 * count events and rating history. Run with `npm run seed`. Refuses to touch a
 * database that already has users unless `--force` is passed (which wipes everything).
 *
 * Other modes (safe on a live database, point DATABASE_URL at it):
 *   --students-only     add the 40 fake students if missing, change nothing else
 *   --remove-students   delete the 40 fake students and their guesses / history
 *   --reset-season      delete all sessions and reset every rating; keeps accounts
 */
import { config } from './config.js';
import { getDb, num } from './db.js';
import { ensureSchema } from './schema.js';
import { hashPassword } from './auth.js';
import { scoreSession } from './sessions.js';

const MODERATORS = ['max', 'alex_mod', 'sam_mod'];
const STUDENTS = [
  'quokka', 'brenner_fan', 'lens_flare', 'eigenvalue', 'spectacle', 'fourier_fox', 'blink182', 'optics_andy',
  'gauss_gal', 'monocle', 'pupil_dilator', 'hilbert', 'bifocal_bill', 'chalk_dust', 'l2norm', 'myopic_mike',
  'astigmatism', 'diffraction', 'jacobian', 'squint', 'retina_ray', 'stochastic_sue', 'dioptre', 'markov_chain',
  'nearsighted_nat', 'cornea_kate', 'lagrangian', 'glasses_off', 'entropy_ed', 'hessian', 'lens_cap', 'twenty_twenty',
  'variance_vic', 'laplace_lou', 'saccade', 'kalman_kim', 'polarizer', 'poisson_pat', 'iris_ivy', 'gradient_greg',
];

/** Deterministic pseudo-random generator so the seed is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Add the 40 fake students to an existing database without touching anything else. */
async function studentsOnly(): Promise<void> {
  const db = await getDb();
  await ensureSchema(db);
  const passwordHash = await hashPassword(process.env.SEED_PASSWORD || 'specs-demo-2026');
  let added = 0;
  for (const name of STUDENTS) {
    const exists = await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [name]);
    if (exists.rows.length) continue;
    await db.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [name, passwordHash]);
    added++;
  }
  console.log(`Added ${added} fake students (${STUDENTS.length - added} already existed). Password: ${process.env.SEED_PASSWORD || 'specs-demo-2026'}`);
  await db.close();
}

/** Remove the 40 fake students and everything they did (guesses, rating history). */
async function removeStudents(): Promise<void> {
  const db = await getDb();
  const r = await db.query(
    `DELETE FROM users WHERE is_moderator = false
       AND (lower(username) = ANY(SELECT lower(unnest($1::text[]))) OR username LIKE 'sim\_%')`,
    [STUDENTS],
  );
  console.log(`Removed ${r.rowCount} fake students (seeded and simulated). Their guesses and rating history went with them.`);
  await db.close();
}

/** Fresh season: delete all sessions (cascades to guesses, count events, rating history) and reset ratings. Keeps accounts. */
async function resetSeason(): Promise<void> {
  const db = await getDb();
  await db.exec('DELETE FROM sessions; UPDATE users SET rating = ' + config.eloStart + ', sessions_played = 0;');
  console.log('All sessions deleted and every rating reset to ' + config.eloStart + '. Accounts kept.');
  await db.close();
}

async function main(): Promise<void> {
  if (process.argv.includes('--students-only')) return studentsOnly();
  if (process.argv.includes('--remove-students')) return removeStudents();
  if (process.argv.includes('--reset-season')) return resetSeason();
  const force = process.argv.includes('--force');
  const db = await getDb();
  await ensureSchema(db);

  const existing = await db.query<{ n: unknown }>('SELECT COUNT(*)::int AS n FROM users');
  if (num(existing.rows[0]?.n) > 0) {
    if (!force) {
      console.log('Database already has users. Re-run with --force to wipe and reseed.');
      await db.close();
      return;
    }
    console.log('Wiping existing data...');
    await db.exec('TRUNCATE rating_history, count_events, guesses, sessions, users RESTART IDENTITY CASCADE');
  }

  const rand = mulberry32(215);
  const passwordHash = await hashPassword(process.env.SEED_PASSWORD || 'specs-demo-2026');

  const userIds = new Map<string, number>();
  for (const name of MODERATORS) {
    const r = await db.query<{ id: unknown }>(
      'INSERT INTO users (username, password_hash, is_moderator) VALUES ($1, $2, true) RETURNING id',
      [name, passwordHash],
    );
    userIds.set(name, num(r.rows[0].id));
  }
  for (const name of STUDENTS) {
    const r = await db.query<{ id: unknown }>('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [
      name,
      passwordHash,
    ]);
    userIds.set(name, num(r.rows[0].id));
  }

  // One finished lecture, 4 days ago, 75 minutes.
  const durationSec = config.defaultDurationSec;
  const startedAt = new Date(Date.now() - 4 * 24 * 3600 * 1000);
  startedAt.setHours(10, 30, 0, 0);
  const lockedAt = new Date(startedAt.getTime() + config.lockAfterSec * 1000);
  const endsAt = new Date(startedAt.getTime() + durationSec * 1000);
  const finishedAt = new Date(endsAt.getTime() + 2 * 60 * 1000);
  const title = `Lecture · ${startedAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')}`;

  const s = await db.query<{ id: unknown }>(
    `INSERT INTO sessions (title, state, duration_sec, started_at, locked_at, ends_at, finished_at, created_by, created_at)
     VALUES ($1, 'finished', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [title, durationSec, startedAt, lockedAt, endsAt, finishedAt, userIds.get('max'), new Date(startedAt.getTime() - 3600 * 1000)],
  );
  const sessionId = num(s.rows[0].id);

  // Guesses: roughly normal around 9 with SD 3.5, a couple of wild ones, moderators guess too.
  const guessers = [...STUDENTS, ...MODERATORS];
  for (const name of guessers) {
    let g = Math.round(9 + 3.5 * gaussian(rand));
    if (rand() < 0.05) g = Math.round(20 + 10 * rand());
    g = Math.max(config.guessMin, Math.min(config.guessMax, g));
    const at = new Date(startedAt.getTime() - Math.floor(rand() * 20 * 60 * 1000) + Math.floor(rand() * 8 * 60 * 1000));
    await db.query(
      'INSERT INTO guesses (session_id, user_id, value, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
      [sessionId, userIds.get(name), g, at],
    );
  }

  // Count events: 12 real removals spread over the lecture, plus one mis-tap that was undone.
  const events: { delta: number; at: Date; mod: string }[] = [];
  let t = startedAt.getTime() + 4 * 60 * 1000;
  for (let i = 0; i < 12; i++) {
    t += (2 + rand() * 9) * 60 * 1000;
    if (t > endsAt.getTime() - 60 * 1000) break;
    events.push({ delta: 1, at: new Date(t), mod: i % 3 === 0 ? 'alex_mod' : 'max' });
    if (i === 6) {
      events.push({ delta: 1, at: new Date(t + 400), mod: 'max' });
      events.push({ delta: -1, at: new Date(t + 2600), mod: 'max' });
    }
  }
  for (const e of events) {
    await db.query('INSERT INTO count_events (session_id, moderator_id, delta, created_at) VALUES ($1, $2, $3, $4)', [
      sessionId,
      userIds.get(e.mod),
      e.delta,
      e.at,
    ]);
  }
  const finalCount = events.reduce((a, e) => a + e.delta, 0);
  await db.query('UPDATE sessions SET final_count = $2 WHERE id = $1', [sessionId, finalCount]);

  const scored = await db.transaction((q) => scoreSession(q, sessionId));
  const top = await db.query<{ username: string; rating: unknown }>(
    'SELECT username, rating FROM users WHERE is_moderator = false ORDER BY rating DESC LIMIT 5',
  );

  console.log(`Seeded ${MODERATORS.length} moderators (${MODERATORS.join(', ')}) and ${STUDENTS.length} students.`);
  console.log(`Password for every seeded account: ${process.env.SEED_PASSWORD || 'specs-demo-2026'}`);
  console.log(`Finished session #${sessionId} "${title}" with final count ${finalCount}, scored: ${scored}.`);
  console.log('Top ratings:', top.rows.map((r) => `${r.username} ${num(r.rating)}`).join(', '));
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
