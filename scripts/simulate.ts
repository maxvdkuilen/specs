/**
 * Fake lecture on a compressed timeline, driven purely through the public API.
 *
 *   npm run simulate                      # against http://localhost:3000, 3-minute lecture
 *   npm run simulate -- --base=https://specs.example.com --minutes=5 --count=12 --students=30
 *
 * Steps: log in as a moderator, create a session, have seeded students guess,
 * start the lecture, fire scripted +1 / -1 events over the compressed duration,
 * then end the lecture. Open /live on a phone (as a student who guessed) and watch.
 *
 * Tip: start the server with LOCK_AFTER_SEC=30 so the lock also happens on the compressed timeline.
 */
import 'dotenv/config';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);
const BASE = (args.base as string) || process.env.SIMULATE_BASE || 'http://localhost:3000';
const MINUTES = Number(args.minutes ?? 3);
const TARGET = Number(args.count ?? 11);
const STUDENTS = Number(args.students ?? 25);
const MOD_USER = (args.mod as string) || process.env.SIMULATE_MOD || 'max';
const PASSWORD = (args.password as string) || process.env.SEED_PASSWORD || 'specs-demo-2026';
const NO_STUDENTS = args['no-students'] === 'true';

const SEEDED = [
  'quokka', 'brenner_fan', 'lens_flare', 'eigenvalue', 'spectacle', 'fourier_fox', 'blink182', 'optics_andy',
  'gauss_gal', 'monocle', 'pupil_dilator', 'hilbert', 'bifocal_bill', 'chalk_dust', 'l2norm', 'myopic_mike',
  'astigmatism', 'diffraction', 'jacobian', 'squint', 'retina_ray', 'stochastic_sue', 'dioptre', 'markov_chain',
  'nearsighted_nat', 'cornea_kate', 'lagrangian', 'glasses_off', 'entropy_ed', 'hessian', 'lens_cap', 'twenty_twenty',
  'variance_vic', 'laplace_lou', 'saccade', 'kalman_kim', 'polarizer', 'poisson_pat', 'iris_ivy', 'gradient_greg',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`${new Date().toLocaleTimeString()}  ${msg}`);

class Client {
  cookie = '';
  async call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : {}) as T };
  }
  async must<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.call<T & { error?: string }>(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${r.json.error ?? ''}`);
    return r.json;
  }
}

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

async function main() {
  log(`Simulating a ${MINUTES}-minute lecture at ${BASE}, target count ${TARGET}`);
  const mod = new Client();
  await mod.must('POST', '/api/login', { username: MOD_USER, password: PASSWORD });
  log(`Logged in as moderator ${MOD_USER}`);

  const active = await mod.must<{ session: { id: number; state: string } | null }>('GET', '/api/mod/active');
  if (active.session) {
    throw new Error(
      `A session is already active (id ${active.session.id}, ${active.session.state}). End it from /mod first.`,
    );
  }

  const created = await mod.must<{ session: { id: number; title: string } }>('POST', '/api/mod/sessions', {
    title: `Simulated lecture · ${new Date().toLocaleTimeString()}`,
    durationSec: Math.round(MINUTES * 60),
  });
  const id = created.session.id;
  log(`Created draft session #${id} "${created.session.title}". Students can guess now.`);

  if (!NO_STUDENTS) {
    let ok = 0;
    for (const name of SEEDED.slice(0, STUDENTS)) {
      const c = new Client();
      const guess = Math.max(0, Math.min(50, Math.round(TARGET + 3 * gaussian())));
      const r = await c.call('POST', '/api/login', { username: name, password: PASSWORD, guess });
      if (r.status === 200) ok++;
      await sleep(150);
    }
    log(`${ok} seeded students guessed (run "npm run seed" first if this is 0).`);
    await mod.call('PUT', '/api/guess', { value: TARGET + 1 });
  }

  log('Starting in 5 seconds. Open /live on your phone now.');
  await sleep(5000);
  await mod.must('POST', `/api/mod/sessions/${id}/start`);
  log('Lecture started. Firing count events...');

  // Spread TARGET events over the middle 90% of the lecture with some jitter; one mis-tap gets undone.
  const total = MINUTES * 60 * 1000;
  const times: number[] = [];
  for (let i = 0; i < TARGET; i++) {
    const base = total * 0.05 + (total * 0.9 * (i + 0.5)) / TARGET;
    times.push(base + (Math.random() - 0.5) * (total * 0.6) / TARGET);
  }
  times.sort((a, b) => a - b);
  const undoAt = TARGET >= 4 ? Math.floor(TARGET / 2) : -1;
  const t0 = Date.now();
  for (let i = 0; i < times.length; i++) {
    const wait = t0 + times[i] - Date.now();
    if (wait > 0) await sleep(wait);
    const r = await mod.must<{ count: number }>('POST', `/api/mod/sessions/${id}/count`, { delta: 1 });
    log(`+1 -> count ${r.count}`);
    if (i === undoAt) {
      await sleep(400);
      const r2 = await mod.must<{ count: number }>('POST', `/api/mod/sessions/${id}/count`, { delta: 1 });
      log(`+1 (mis-tap) -> count ${r2.count}`);
      await sleep(1500);
      const r3 = await mod.must<{ count: number }>('POST', `/api/mod/sessions/${id}/count`, { delta: -1 });
      log(`-1 (undo) -> count ${r3.count}`);
    }
  }
  const remaining = t0 + total - Date.now();
  if (remaining > 0) {
    log(`Waiting ${Math.round(remaining / 1000)}s for the timer to run out...`);
    await sleep(remaining + 1500);
  }
  const ended = await mod.must<{ stats: Record<string, number> }>('POST', `/api/mod/sessions/${id}/end`);
  log(`Ended. Final count ${ended.stats.finalCount}, ${ended.stats.guessCount} guesses, ${ended.stats.exactCount} exact.`);
  log('Results modal is showing on every connected phone. Check /leaderboard.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
