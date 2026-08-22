import { useCallback, useEffect, useState } from 'react';
import { api, grantUnlock } from '../api/client';

// Injected by Vite at build time from build-info.json - see vite.config.ts.
declare const __BUILD_ID__: string;
declare const __BUILD_TIME__: number;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
export const BUILD_TIME: number = typeof __BUILD_TIME__ === 'number' ? __BUILD_TIME__ : 0;

interface ServerVersion {
  buildId: string;
  buildTime: number;
  branch: string;
  minClientBuildTime: number;
}

/// Checked when the app opens, whenever it comes back to the foreground, and on a slow timer.
/// A partner leaves this open on a phone for days; the foreground check is the one that
/// actually catches most deploys.
const POLL_MS = 15 * 60 * 1000;

export interface UpdateState {
  available: boolean;
  /// The running build can no longer talk to this server correctly, so carrying on is not an
  /// option. Only ever true when the operator has deliberately said so via
  /// MIN_CLIENT_BUILD_TIME - see the note in backend/src/env.ts.
  required: boolean;
  serverBuildId: string;
  apply: () => void;
}

export function useAppUpdate(): UpdateState {
  const [server, setServer] = useState<ServerVersion | null>(null);

  const check = useCallback(async () => {
    try {
      setServer(await api<ServerVersion>('/version'));
    } catch {
      // Offline or the server is restarting mid-deploy. Not worth surfacing: the next check
      // will either find a new build or find nothing changed.
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  // A dev build (buildTime 0) never nags - otherwise `vite dev` would show an update prompt
  // against any real server it is pointed at.
  const known = BUILD_TIME > 0 && server !== null;
  const available = known && server.buildTime > BUILD_TIME;
  const required = known && BUILD_TIME < server.minClientBuildTime;

  const apply = useCallback(() => {
    // The user was already past the lock screen and just chose this, so re-asking for the PIN
    // on the other side of a reload is friction with no security value. One-shot, per tab.
    grantUnlock();
    // A plain reload is enough because index.html is served no-cache and every asset is
    // content-hashed (see backend/src/static.ts). localStorage survives, so the session,
    // theme and group all come back exactly as they were.
    window.location.reload();
  }, []);

  return { available, required, serverBuildId: server?.buildId ?? BUILD_ID, apply };
}
