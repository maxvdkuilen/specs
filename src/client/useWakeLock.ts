import { useEffect } from 'react';

type WakeLockSentinel = { release: () => Promise<void>; addEventListener: (t: 'release', cb: () => void) => void };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } };

/**
 * Keeps the phone screen on while the component is mounted (live view, moderator counter).
 * Phones otherwise dim and lock after 30 to 60 seconds without a touch. The lock is
 * released by the OS when the tab is hidden, so it is re-requested on return.
 */
export function useWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        sentinel = await nav.wakeLock!.request('screen');
        sentinel.addEventListener('release', () => {
          sentinel = null;
        });
      } catch {
        /* low battery mode or unsupported: fine, nothing to do */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !sentinel) void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release();
    };
  }, [enabled]);
}
