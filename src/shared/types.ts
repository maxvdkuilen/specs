/** Wire types shared between server and client. */

export type SessionState = 'draft' | 'open' | 'locked' | 'finished';

export interface PublicConfig {
  professorName: string;
  className: string;
  guessMin: number;
  guessMax: number;
  lockAfterSec: number;
  defaultDurationSec: number;
  projectionTauSec: number;
  projectionMinElapsedSec: number;
  projectionCrowdTauSec: number;
}

export interface Me {
  id: number;
  username: string;
  isModerator: boolean;
  rating: number;
  sessionsPlayed: number;
}

export interface SessionInfo {
  id: number;
  title: string;
  state: SessionState;
  durationSec: number;
  /** ISO timestamps (null until the transition happens). */
  startedAt: string | null;
  lockedAt: string | null;
  endsAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface SessionStatsWire {
  finalCount: number;
  guessCount: number;
  guessMean: number;
  guessMedian: number;
  guessSd: number;
  exactCount: number;
  within1Sd: number;
  within2Sd: number;
}

export interface MyResult {
  guess: number;
  error: number;
  /** Average competition rank, 1-based. Null for moderators (not scored). */
  rank: number | null;
  participants: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
}

/** Everything the live view needs. Sent on websocket connect and on GET /api/live. */
export interface LiveSnapshot {
  serverTime: number;
  session: SessionInfo | null;
  count: number;
  lastEventId: number | null;
  /** Number of non-moderator guesses per value, index = value (length guessMax + 1). */
  bins: number[];
  /** Same for moderator guesses (drawn outlined, not scored). */
  modBins: number[];
  /** Finished lectures (final count and length), for the projection prior. */
  pastLectures: { finalCount: number; durationSec: number }[];
  myGuess: number | null;
  /** Whether the current user may still submit / edit a guess. */
  canGuess: boolean;
  stats: SessionStatsWire | null;
  myResult: MyResult | null;
}

export interface CountEventWire {
  id: number;
  delta: number;
  createdAt: string;
  moderator: string;
}

export interface ModState {
  serverTime: number;
  session: SessionInfo | null;
  count: number;
  recentEvents: CountEventWire[];
  guessCount: number;
  /** Warning when a session has been active for a very long time. */
  longRunning: boolean;
  lastFinished: (SessionInfo & { finalCount: number | null; guessCount: number | null }) | null;
}

export type ServerMessage =
  | { type: 'snapshot'; data: LiveSnapshot }
  | { type: 'count_changed'; count: number; eventId: number; serverTime: number }
  | { type: 'guess_added'; value: number; moderator: boolean }
  | { type: 'guess_changed'; from: number; to: number; moderator: boolean }
  | { type: 'state_changed'; session: SessionInfo; serverTime: number }
  | { type: 'session_finished'; session: SessionInfo; stats: SessionStatsWire; serverTime: number }
  | { type: 'pong'; serverTime: number };

export interface LeaderboardRow {
  rank: number;
  userId: number;
  username: string;
  rating: number;
  sessionsPlayed: number;
  provisional: boolean;
  lastDelta: number | null;
  /** rating_after of the last few sessions, oldest first. */
  spark: number[];
  isMe: boolean;
}

export interface SessionRankingRow {
  rank: number;
  username: string;
  guess: number;
  error: number;
  ratingDelta: number | null;
  isMe: boolean;
}

export interface LeaderboardResponse {
  season: LeaderboardRow[];
  me: LeaderboardRow | null;
  lecture: {
    session: SessionInfo;
    finalCount: number;
    rows: SessionRankingRow[];
  } | null;
}

export interface ProfileHistoryRow {
  sessionId: number;
  title: string;
  finishedAt: string | null;
  guess: number;
  finalCount: number | null;
  error: number | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  rank: number | null;
  participants: number | null;
}

export interface ProfileResponse {
  me: Me;
  history: ProfileHistoryRow[];
}

export interface Bootstrap {
  serverTime: number;
  config: PublicConfig;
  me: Me | null;
  /** Current session (active, or the most recently finished one). */
  session: SessionInfo | null;
  myGuess: number | null;
  canGuess: boolean;
}
