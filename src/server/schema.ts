import { config } from './config.js';
import type { Db } from './db.js';

/** Idempotent schema. Mirrors PRD section 8. */
export function schemaSql(): string {
  return `
CREATE TABLE IF NOT EXISTS users (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username        text NOT NULL,
  password_hash   text NOT NULL,
  is_moderator    boolean NOT NULL DEFAULT false,
  rating          integer NOT NULL DEFAULT ${config.eloStart},
  sessions_played integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         text NOT NULL,
  state         text NOT NULL CHECK (state IN ('draft', 'open', 'locked', 'finished')),
  duration_sec  integer NOT NULL CHECK (duration_sec > 0),
  started_at    timestamptz,
  locked_at     timestamptz,
  ends_at       timestamptz,
  finished_at   timestamptz,
  scored_at     timestamptz,
  final_count   integer,
  guess_count   integer,
  guess_mean    double precision,
  guess_median  double precision,
  guess_sd      double precision,
  exact_count   integer,
  within_1sd    integer,
  within_2sd    integer,
  created_by    integer NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- At most one session may be draft/open/locked at any time.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_idx
  ON sessions ((state IN ('draft', 'open', 'locked')))
  WHERE state IN ('draft', 'open', 'locked');

CREATE TABLE IF NOT EXISTS guesses (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value       integer NOT NULL CHECK (value >= ${config.guessMin} AND value <= ${config.guessMax}),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS count_events (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id    integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  moderator_id  integer NOT NULL REFERENCES users(id),
  delta         integer NOT NULL CHECK (delta IN (-1, 1)),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS count_events_session_idx ON count_events (session_id, id);

CREATE TABLE IF NOT EXISTS rating_history (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id     integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id        integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating_before  integer NOT NULL,
  rating_after   integer NOT NULL,
  rank           double precision NOT NULL,
  error          integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS rating_history_user_idx ON rating_history (user_id, id);
`;
}

export async function ensureSchema(db: Db): Promise<void> {
  await db.exec(schemaSql());
}
