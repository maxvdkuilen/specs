import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { serverNow, syncServerTime } from './clock';
import type { LiveSnapshot, ServerMessage, SessionInfo } from '../shared/types';

export interface LiveState {
  snap: LiveSnapshot | null;
  connected: boolean;
  /** Increments every time a session_finished message arrives. */
  finishedTick: number;
  /** Refetch the full personalised snapshot over HTTP. */
  refresh: () => Promise<void>;
  /** Optimistically record the user's own guess after a successful PUT. */
  setMyGuess: (value: number) => void;
}

function canGuessClient(session: SessionInfo | null): boolean {
  if (!session) return false;
  if (session.state === 'draft') return true;
  if (session.state !== 'open') return false;
  return !session.lockedAt || serverNow() < new Date(session.lockedAt).getTime();
}

/**
 * Keeps a LiveSnapshot in sync over the websocket. Reconnects with backoff, resyncs
 * when the tab becomes visible again (phones lock constantly), and falls back to an
 * HTTP refetch when the socket has been down for a while.
 */
export function useLive(enabled = true): LiveState {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [finishedTick, setFinishedTick] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(500);
  const timerRef = useRef<number | null>(null);
  const closedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.live();
      syncServerTime(s.serverTime);
      setSnap(s);
    } catch {
      /* keep what we have */
    }
  }, []);

  const setMyGuess = useCallback((value: number) => {
    setSnap((s) => (s ? { ...s, myGuess: value } : s));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    closedRef.current = false;

    const applyMessage = (msg: ServerMessage) => {
      switch (msg.type) {
        case 'snapshot':
          syncServerTime(msg.data.serverTime);
          retryRef.current = 500;
          setSnap(msg.data);
          break;
        case 'pong':
          syncServerTime(msg.serverTime);
          break;
        case 'count_changed':
          syncServerTime(msg.serverTime);
          setSnap((s) => (s ? { ...s, count: msg.count, lastEventId: msg.eventId } : s));
          break;
        case 'guess_added':
          setSnap((s) => {
            if (!s) return s;
            const key = msg.moderator ? 'modBins' : 'bins';
            const arr = [...s[key]];
            if (msg.value >= 0 && msg.value < arr.length) arr[msg.value] += 1;
            return { ...s, [key]: arr };
          });
          break;
        case 'guess_changed':
          setSnap((s) => {
            if (!s) return s;
            const key = msg.moderator ? 'modBins' : 'bins';
            const arr = [...s[key]];
            if (msg.from >= 0 && msg.from < arr.length) arr[msg.from] = Math.max(0, arr[msg.from] - 1);
            if (msg.to >= 0 && msg.to < arr.length) arr[msg.to] += 1;
            return { ...s, [key]: arr };
          });
          break;
        case 'state_changed':
          syncServerTime(msg.serverTime);
          setSnap((s) => {
            // A brand-new draft replaces whatever finished session we were showing.
            if (!s || !s.session || s.session.id !== msg.session.id) {
              void refresh();
              return s;
            }
            return { ...s, session: msg.session, canGuess: canGuessClient(msg.session) };
          });
          break;
        case 'session_finished':
          syncServerTime(msg.serverTime);
          setSnap((s) =>
            s && s.session && s.session.id === msg.session.id
              ? { ...s, session: msg.session, stats: msg.stats, canGuess: false }
              : s,
          );
          setFinishedTick((t) => t + 1);
          // Personal result (rank, rating delta) needs an authenticated fetch. Jitter to spread 300 phones.
          window.setTimeout(() => void refresh(), 200 + Math.random() * 1500);
          break;
      }
    };

    const connect = () => {
      if (closedRef.current) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        retryRef.current = 500;
      };
      ws.onmessage = (ev) => {
        try {
          applyMessage(JSON.parse(ev.data) as ServerMessage);
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (closedRef.current) return;
        const delay = retryRef.current;
        retryRef.current = Math.min(delay * 2, 10_000);
        timerRef.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    };

    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resync' }));
      } else {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        retryRef.current = 500;
        connect();
      }
    };

    // Keepalive ping every 25s so proxies do not drop idle sockets; doubles as clock sync.
    const ping = window.setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 25_000);

    // Slow fallback poll in case the socket is silently dead.
    const poll = window.setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) void refresh();
    }, 5_000);

    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    connect();

    return () => {
      closedRef.current = true;
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      window.clearInterval(ping);
      window.clearInterval(poll);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, refresh]);

  return { snap, connected, finishedTick, refresh, setMyGuess };
}
