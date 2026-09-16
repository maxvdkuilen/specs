import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, loadPendingGuess, savePendingGuess } from './api';
import { syncServerTime } from './clock';
import type { Bootstrap, Me } from '../shared/types';

export interface AppStore {
  boot: Bootstrap | null;
  bootError: string | null;
  refreshBoot: () => Promise<Bootstrap | null>;
  setMe: (me: Me | null) => void;
  pendingGuess: number | null;
  setPendingGuess: (v: number | null) => void;
}

const Ctx = createContext<AppStore | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [pendingGuess, setPending] = useState<number | null>(() => loadPendingGuess());

  const refreshBoot = useCallback(async () => {
    try {
      const b = await api.bootstrap();
      syncServerTime(b.serverTime);
      setBoot(b);
      setBootError(null);
      return b;
    } catch (err) {
      setBootError((err as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshBoot();
    // Phones come back from the lock screen with a stale view; refetch whenever the tab is visible again.
    const wake = () => {
      if (document.visibilityState === 'visible') void refreshBoot();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, [refreshBoot]);

  const setMe = useCallback((me: Me | null) => {
    setBoot((b) => (b ? { ...b, me, myGuess: me ? b.myGuess : null } : b));
  }, []);

  const setPendingGuess = useCallback((v: number | null) => {
    savePendingGuess(v);
    setPending(v);
  }, []);

  const value = useMemo<AppStore>(
    () => ({ boot, bootError, refreshBoot, setMe, pendingGuess, setPendingGuess }),
    [boot, bootError, refreshBoot, setMe, pendingGuess, setPendingGuess],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): AppStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}
