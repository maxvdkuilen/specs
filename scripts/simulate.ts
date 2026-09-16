/**
 * Fake lecture on a compressed timeline, driven purely through the public API.
 * Invents its own students: random names, random guesses, and a random number of
 * glasses removals fired automatically over the lecture. Nothing needs seeding.
 *
 *   npm run simulate
 *   npm run simulate -- --base=https://specs-xxxx.onrender.com --mod=max --password=secret
 *   npm run simulate -- --students=40 --minutes=3 --wait=60
 *
 * Options (both "--name=value" and "--name value" work):
 *   --base      server URL                       default http://localhost:3000
 *   --mod       moderator username               default max
 *   --password  moderator password               default SEED_PASSWORD or specs-demo-2026
 *   --students  simulated students               default 40
 *   --minutes   lecture length                   default 3
 *   --count     glasses removals                 default random 5..18
 *   --wait      seconds between Start and the first simulated guess   default 0
 *   --no-students  skip simulated students (only you and friends guess)
 *
 * Simulated students are real accounts named like "sim_eager_otter_07" with the
 * password "specs-sim-2026". Remove them later with `npm run seed -- --remove-students`.
 */
import 'dotenv/config';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const rawArgs = process.argv.slice(2);
const args: Record<string, string> = {};
for (let i = 0; i < rawArgs.length; i++) {
  const m = rawArgs[i].match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) continue;
  if (m[2] !== undefined) args[m[1]] = m[2];
  else if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('--')) args[m[1]] = rawArgs[++i];
  else args[m[1]] = 'true';
}

function numArg(name: string, fallback: number, min: number, max: number): number {
  if (args[name] === undefined) return fallback;
  const n = Number(args[name]);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.error(`--${name} must be a number between ${min} and ${max}, got "${args[name]}"`);
    process.exit(1);
  }
  return n;
}

const BASE = (args.base || process.env.SIMULATE_BASE || 'http://localhost:3000').replace(/\/+$/, '');
const MOD_USER = args.mod || process.env.SIMULATE_MOD || 'max';
const PASSWORD = args.password || process.env.SEED_PASSWORD || 'specs-demo-2026';
const STUDENTS = numArg('students', 40, 0, 200);
const MINUTES = numArg('minutes', 3, 1, 180);
const WAIT_SEC = numArg('wait', 0, 0, 3600);
const NO_STUDENTS = args['no-students'] === 'true';
const SIM_PASSWORD = 'specs-sim-2026';

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const rndInt = (lo: number, hi: number) => Math.floor(rnd(lo, hi + 1));
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const ADJECTIVES = ['eager', 'sleepy', 'bold', 'quiet', 'fuzzy', 'brisk', 'lucky', 'witty', 'calm', 'zesty', 'mellow', 'nimble', 'rusty', 'shiny', 'jolly', 'sly'];
const NOUNS = ['otter', 'falcon', 'badger', 'lemur', 'heron', 'walrus', 'gecko', 'puffin', 'yak', 'ferret', 'koala', 'moose', 'newt', 'quail', 'ibis', 'lynx'];

/** Names are picked randomly but deterministically by index, so re-runs reuse the same accounts. */
function studentName(i: number): string {
  const a = ADJECTIVES[(i * 7 + 3) % ADJECTIVES.length];
  const n = NOUNS[(i * 11 + 5) % NOUNS.length];
  return `sim_${a}_${n}_${String(i + 1).padStart(2, '0')}`;
}

// The number of glasses removals is random unless given; the crowd's guesses centre
// a little off the truth, with spread, so the histogram looks like a real class.
const TARGET = numArg('count', rndInt(5, 18), 0, 50);
const CROWD_CENTER = TARGET + rnd(-2.5, 2.5);
const CROWD_SD = rnd(2.5, 4);

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`${new Date().toLocaleTimeString()}  ${msg}`);

class Client {
  cookie = '';
  /** One request with retries on network errors, 5xx and non-JSON bodies (Render restarts, wifi blips). */
  async call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T & { error?: string } }> {
    let lastErr = '';
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(BASE + path, {
          method,
          headers: { 'content-type': 'application/json', cookie: this.cookie },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const set = res.headers.get('set-cookie');
        if (set) this.cookie = set.split(';')[0];
        const text = await res.text();
        if (res.status >= 500) {
          lastErr = `${res.status} from server`;
        } else {
          try {
            return { status: res.status, json: (text ? JSON.parse(text) : {}) as T & { error?: string } };
          } catch {
            lastErr = `${res.status} with a non-JSON body: ${text.slice(0, 60).replace(/\s+/g, ' ')}`;
          }
        }
      } catch (err) {
        lastErr = `network error: ${(err as Error).message}`;
      }
      if (attempt < 4) {
        log(`  ${method} ${path} failed (${lastErr}), retrying in ${attempt * 2}s...`);
        await sleep(attempt * 2000);
      }
    }
    throw new Error(`${method} ${path} kept failing: ${lastErr}. Is ${BASE} up? (Render takes ~1 min to wake and a few minutes to redeploy.)`);
  }
  async must<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.call<T>(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${r.json.error ?? ''}`);
    return r.json;
  }
}

/** Log in as a simulated student, creating the account on first use. Returns the client or null. */
async function studentSession(name: string): Promise<Client | null> {
  const c = new Client();
  try {
    const login = await c.call('POST', '/api/login', { username: name, password: SIM_PASSWORD });
    if (login.status === 200) return c;
    if (login.status !== 401) {
      log(`  could not log in ${name}: ${login.json.error ?? login.status}`);
      return null;
    }
    const signup = await c.call('POST', '/api/signup', { username: name, password: SIM_PASSWORD });
    if (signup.status === 201) return c;
    log(`  could not create ${name}: ${signup.json.error ?? signup.status}`);
    return null;
  } catch (err) {
    log(`  ${name}: ${(err as Error).message}`);
    return null;
  }
}

function randomGuess(): number {
  let g = Math.round(CROWD_CENTER + CROWD_SD * gaussian());
  if (Math.random() < 0.06) g = rndInt(TARGET + 8, TARGET + 20); // the occasional wild optimist
  return Math.max(0, Math.min(50, g));
}

// ---------------------------------------------------------------------------
// The lecture
// ---------------------------------------------------------------------------

async function main() {
  log(`Simulating a ${MINUTES}-minute lecture at ${BASE}`);
  log(`Secret plan: ${TARGET} glasses removals. Crowd will guess around ${CROWD_CENTER.toFixed(1)} ± ${CROWD_SD.toFixed(1)}.`);

  const mod = new Client();
  await mod.must('POST', '/api/login', { username: MOD_USER, password: PASSWORD });
  log(`Logged in as moderator ${MOD_USER}`);

  const active = await mod.must<{ session: { id: number; state: string } | null }>('GET', '/api/mod/active');
  if (active.session) {
    throw new Error(`A session is already active (id ${active.session.id}, ${active.session.state}). End it from /mod first.`);
  }

  const created = await mod.must<{ session: { id: number; title: string } }>('POST', '/api/mod/sessions', {
    title: `Simulated lecture · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    durationSec: Math.round(MINUTES * 60),
  });
  const id = created.session.id;
  log(`Created draft session #${id} "${created.session.title}". Phones now show the guess screen.`);

  await mod.must('POST', `/api/mod/sessions/${id}/start`);
  log('Lecture started. Timer running; guessing stays open for the first minutes.');
  if (WAIT_SEC > 0) {
    log(`Waiting ${WAIT_SEC} seconds before the simulated students arrive.`);
    await sleep(WAIT_SEC * 1000);
  }
  const t0 = Date.now();

  const students: Client[] = [];
  if (!NO_STUDENTS && STUDENTS > 0) {
    log(`Bringing in ${STUDENTS} simulated students while the clock runs...`);
    for (let i = 0; i < STUDENTS; i++) {
      const c = await studentSession(studentName(i));
      if (!c) continue;
      const guess = randomGuess();
      const r = await c.call('PUT', '/api/guess', { value: guess });
      if (r.status === 200) students.push(c);
      else log(`  ${studentName(i)} could not guess: ${r.json.error ?? r.status}`);
      await sleep(rnd(120, 400)); // guesses trickle in, bars spring up one by one
    }
    log(`${students.length} of ${STUDENTS} simulated students guessed.`);
    if (students.length === 0) {
      log('WARNING: no simulated student could guess (see reasons above). Continuing with the lecture anyway.');
    }
  }

  // A few students change their minds while guessing is still open.
  const changers = students.filter(() => Math.random() < 0.15);
  for (const c of changers) {
    await sleep(rnd(500, 2500));
    await c.call('PUT', '/api/guess', { value: randomGuess() }).catch(() => undefined);
  }
  if (changers.length) log(`${changers.length} students edited their guess.`);

  // Removals at random moments across the middle 90% of the lecture, plus one mis-tap that gets undone.
  const total = MINUTES * 60 * 1000;
  const times = Array.from({ length: TARGET }, () => rnd(total * 0.05, total * 0.95)).sort((a, b) => a - b);
  const undoAt = TARGET >= 4 ? rndInt(1, TARGET - 2) : -1;
  for (let i = 0; i < times.length; i++) {
    const wait = t0 + times[i] - Date.now();
    if (wait > 0) await sleep(wait);
    const r = await mod.must<{ count: number }>('POST', `/api/mod/sessions/${id}/count`, { delta: 1 });
    log(`glasses off  -> count ${r.count}`);
    if (i === undoAt) {
      await sleep(400);
      const r2 = await mod.must<{ count: number }>('POST', `/api/mod/sessions/${id}/count`, { delta: 1 });
      log(`mis-tap      -> count ${r2.count}`);
      await sleep(1500);
      const r3 = await mod.must<{ count: number }>('POST', `/api/mod/sessions/${id}/count`, { delta: -1 });
      log(`undo         -> count ${r3.count}`);
    }
  }
  log(`All ${TARGET} removals done. Ending in 4 seconds.`);
  await sleep(4000);
  const ended = await mod.must<{ stats: Record<string, number> }>('POST', `/api/mod/sessions/${id}/end`);
  log(`Ended. Final count ${ended.stats.finalCount}, ${ended.stats.guessCount} guesses scored, ${ended.stats.exactCount} exact.`);
  log('Results are showing on every connected phone. See /leaderboard.');
}

main().catch((err) => {
  console.error('\n' + (err.message ?? err));
  process.exit(1);
});
