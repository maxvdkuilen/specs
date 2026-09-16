import type { Bootstrap, LeaderboardResponse, LiveSnapshot, Me, ModState, ProfileResponse, SessionInfo } from '../shared/types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'No connection. Check your wifi and try again.');
  }
  const text = await res.text();
  let json: { error?: string } & Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
  }
  if (!res.ok) throw new ApiError(res.status, (json.error as string) || `Request failed (${res.status}).`);
  return json as T;
}

export interface AuthResponse {
  me: Me;
  guess: number | null;
  guessError: string | null;
}

export const api = {
  bootstrap: () => request<Bootstrap>('GET', '/api/bootstrap'),
  signup: (username: string, password: string, guess: number | null) =>
    request<AuthResponse>('POST', '/api/signup', { username, password, guess }),
  login: (username: string, password: string, guess: number | null) =>
    request<AuthResponse>('POST', '/api/login', { username, password, guess }),
  logout: () => request<{ ok: true }>('POST', '/api/logout'),
  guess: (value: number) => request<{ value: number; created: boolean }>('PUT', '/api/guess', { value }),
  live: () => request<LiveSnapshot>('GET', '/api/live'),
  leaderboard: () => request<LeaderboardResponse>('GET', '/api/leaderboard'),
  me: () => request<ProfileResponse>('GET', '/api/me'),
  mod: {
    state: () => request<ModState>('GET', '/api/mod/state'),
    defaults: () => request<{ title: string; durationSec: number }>('GET', '/api/mod/defaults'),
    create: (title: string, durationSec: number) =>
      request<{ session: SessionInfo }>('POST', '/api/mod/sessions', { title, durationSec }),
    start: (id: number) => request<{ session: SessionInfo }>('POST', `/api/mod/sessions/${id}/start`),
    count: (id: number, delta: 1 | -1) =>
      request<{ count: number; eventId: number }>('POST', `/api/mod/sessions/${id}/count`, { delta }),
    end: (id: number) => request<{ session: SessionInfo }>('POST', `/api/mod/sessions/${id}/end`),
  },
};

const PENDING_KEY = 'specs.pendingGuess';

export function loadPendingGuess(): number | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

export function savePendingGuess(value: number | null): void {
  try {
    if (value === null) sessionStorage.removeItem(PENDING_KEY);
    else sessionStorage.setItem(PENDING_KEY, String(value));
  } catch {
    /* private mode etc. */
  }
}
