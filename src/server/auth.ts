import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { getDb, num } from './db.js';
import type { Me } from '../shared/types.js';

export const COOKIE_NAME = 'specs_session';

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ---------------------------------------------------------------------------
// Username / password validation
// ---------------------------------------------------------------------------

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/** Small blocklist. Substring match, case-insensitive, after removing underscores and digits-as-letters. */
const BLOCKLIST = [
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kike', 'chink', 'spic', 'tranny', 'wetback',
  'coon', 'dyke', 'gook', 'cunt', 'rape', 'nazi', 'hitler',
];

function normalizeForBlocklist(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't');
}

export function validateUsername(username: unknown): string | null {
  if (typeof username !== 'string') return 'Username is required.';
  if (!USERNAME_RE.test(username)) return 'Use 3 to 20 letters, numbers or underscores.';
  const norm = normalizeForBlocklist(username);
  if (BLOCKLIST.some((w) => norm.includes(w))) return 'That username is not allowed.';
  return null;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 200) return 'Password is too long.';
  return null;
}

// ---------------------------------------------------------------------------
// Signed session cookie: "<userId>.<expiresMs>.<hmac>"
// ---------------------------------------------------------------------------

function sign(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

export function makeSessionToken(userId: number, now = Date.now()): string {
  const expires = now + config.sessionDays * 24 * 3600 * 1000;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function parseSessionToken(token: string | undefined, now = Date.now()): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [idStr, expStr, sig] = parts;
  const expected = sign(`${idStr}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return null;
  const id = Number(idStr);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function setSessionCookie(res: Response, userId: number): void {
  const token = makeSessionToken(userId);
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${config.sessionDays * 24 * 3600}`,
  ];
  if (config.isProd) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function userIdFromCookieHeader(header: string | undefined): number | null {
  return parseSessionToken(parseCookies(header)[COOKIE_NAME]);
}

// ---------------------------------------------------------------------------
// Loading the current user
// ---------------------------------------------------------------------------

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  is_moderator: boolean;
  rating: number;
  sessions_played: number;
}

export function toMe(u: UserRow): Me {
  return {
    id: num(u.id),
    username: u.username,
    isModerator: Boolean(u.is_moderator),
    rating: num(u.rating),
    sessionsPlayed: num(u.sessions_played),
  };
}

export async function loadUser(userId: number | null): Promise<UserRow | null> {
  if (!userId) return null;
  const db = await getDb();
  const r = await db.query<UserRow>(
    'SELECT id, username, password_hash, is_moderator, rating, sessions_played FROM users WHERE id = $1',
    [userId],
  );
  return r.rows[0] ?? null;
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const db = await getDb();
  const r = await db.query<UserRow>(
    'SELECT id, username, password_hash, is_moderator, rating, sessions_played FROM users WHERE lower(username) = lower($1)',
    [username],
  );
  return r.rows[0] ?? null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user: UserRow | null;
  }
}

/** Express middleware: sets req.user from the session cookie (or null). */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.user = await loadUser(userIdFromCookieHeader(req.headers.cookie));
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Please log in.' });
    return;
  }
  next();
}

/** Non-moderators get a 404, exactly like a page that does not exist. */
export function requireModerator(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !req.user.is_moderator) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
}
