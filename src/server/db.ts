/**
 * Thin database adapter. Uses node-postgres when DATABASE_URL is set (production,
 * e.g. Neon) and PGlite, an embedded Postgres, otherwise (zero-install local dev).
 * Both speak the same SQL, so every query in the app is written once.
 */
import { config } from './config.js';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  /** Run one or more statements without parameters (schema setup). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'pglite';
}

async function createPostgres(url: string): Promise<Db> {
  const pg = await import('pg');
  const { Pool, types } = pg.default;
  // int8 / numeric come back as strings by default; the app only uses them for counts.
  types.setTypeParser(20, (v: string) => parseInt(v, 10));
  types.setTypeParser(1700, (v: string) => parseFloat(v));
  const pool = new Pool({
    connectionString: url,
    max: 8,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => console.error('[db] pool error', err));

  const wrap = (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> }): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await client.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length };
    },
  });

  return {
    kind: 'postgres',
    query: (sql, params) => wrap(pool).query(sql, params),
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPglite(dir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(dir);
  const wrap = (q: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }> }): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await q.query<T>(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return {
    kind: 'pglite',
    query: (sql, params) => wrap(db).query(sql, params),
    async exec(sql) {
      await db.exec(sql);
    },
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  };
}

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = config.databaseUrl ? createPostgres(config.databaseUrl) : createPglite(config.pgliteDir);
    dbPromise.then((db) => console.log(`[db] connected (${db.kind})`));
  }
  return dbPromise;
}

/** Convert a timestamp column (Date from both drivers, or ISO string) to an ISO string. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return new Date(v).toISOString();
  if (typeof v === 'number') return new Date(v).toISOString();
  return null;
}

export function asDate(v: unknown): Date | null {
  const s = iso(v);
  return s ? new Date(s) : null;
}

export function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
