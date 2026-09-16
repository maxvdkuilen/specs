import { useEffect, useState } from 'react';

/** Server time minus local time, in ms. Updated from every server message that carries serverTime. */
let offset = 0;
let synced = false;

export function syncServerTime(serverTime: number): void {
  const measured = serverTime - Date.now();
  // First sample: take it. Later samples: smooth a little so jitter does not make timers jump.
  offset = synced ? offset * 0.5 + measured * 0.5 : measured;
  synced = true;
}

/** Current time by the server's clock, in ms since epoch. */
export function serverNow(): number {
  return Date.now() + offset;
}

/** Seconds from now until an ISO timestamp, by the server clock. Negative when past. */
export function secondsUntil(iso: string | null | undefined): number {
  if (!iso) return 0;
  return (new Date(iso).getTime() - serverNow()) / 1000;
}

/** Re-renders on an interval and returns the server-corrected now. */
export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
