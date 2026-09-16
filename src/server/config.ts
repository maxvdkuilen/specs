import 'dotenv/config';
import type { PublicConfig } from '../shared/types.js';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: int('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL || '',
  /** Directory for the embedded PGlite database when DATABASE_URL is empty. */
  pgliteDir: process.env.PGLITE_DIR || './data/pglite',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-not-for-production',
  sessionDays: 90,

  professorName: process.env.PROFESSOR_NAME || 'Professor Brenner',
  className: process.env.CLASS_NAME || 'AM215',
  guessMin: int('GUESS_MIN', 0),
  guessMax: int('GUESS_MAX', 50),
  lockAfterSec: int('LOCK_AFTER_SEC', 600),
  defaultDurationSec: int('DEFAULT_DURATION_SEC', 4500),
  projectionTauSec: int('PROJECTION_TAU_SEC', 600),
  projectionMinElapsedSec: int('PROJECTION_MIN_ELAPSED_SEC', 120),
  projectionCrowdTauSec: int('PROJECTION_CROWD_TAU_SEC', 60),
  eloKNew: int('ELO_K_NEW', 48),
  eloK: int('ELO_K', 32),
  eloNewSessions: int('ELO_NEW_SESSIONS', 5),
  eloStart: int('ELO_START', 1000),
  ratingDecayEnabled: bool('RATING_DECAY_ENABLED', false),

  /** Show a warning on /mod when a session has been active this long. */
  longRunningSec: 4 * 3600,

  signupPerIpPerHour: int('SIGNUP_PER_IP_PER_HOUR', 120),
  loginPerIpPer15Min: int('LOGIN_PER_IP_PER_15MIN', 300),
};

if (isProd && config.sessionSecret === 'dev-secret-not-for-production') {
  throw new Error('SESSION_SECRET must be set in production');
}

export function publicConfig(): PublicConfig {
  return {
    professorName: config.professorName,
    className: config.className,
    guessMin: config.guessMin,
    guessMax: config.guessMax,
    lockAfterSec: config.lockAfterSec,
    defaultDurationSec: config.defaultDurationSec,
    projectionTauSec: config.projectionTauSec,
    projectionMinElapsedSec: config.projectionMinElapsedSec,
    projectionCrowdTauSec: config.projectionCrowdTauSec,
  };
}
