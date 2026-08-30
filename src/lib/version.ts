import { useCallback, useEffect, useRef, useState } from 'react';
import { api, grantUnlock } from '../api/client';
import {
  UpdateInstaller,
  installedVersionCode,
  isNative,
  onAppResume,
  type DownloadProgress,
} from './native';

// Injected by Vite at build time from build-info.json - see vite.config.ts.
declare const __BUILD_ID__: string;
declare const __BUILD_TIME__: number;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
export const BUILD_TIME: number = typeof __BUILD_TIME__ === 'number' ? __BUILD_TIME__ : 0;

/// The manifest published to the releases repo. Absent until a version has been released,
/// which is fine on the web - the prompt then just has no name or notes to show. On Android
/// it is the whole mechanism: with no manifest there is no APK to offer and no update.
export interface ReleaseManifest {
  versionCode: number;
  versionName: string;
  releaseNotes: string[];
  forceUpdate: boolean;
  apkUrl?: string;
  apkSha256?: string;
}

interface ServerVersion {
  buildId: string;
  buildTime: number;
  branch: string;
  minClientBuildTime: number;
  release?: ReleaseManifest | null;
}

/// Checked when the app opens, whenever it comes back to the foreground, and on a slow timer.
/// A partner leaves this open on a phone for days; the foreground check is the one that
/// actually catches most releases.
const POLL_MS = 15 * 60 * 1000;

/// Where the Android update flow has got to. The web flow only ever sits at 'available',
/// because applying it is a reload and the page is gone before any other phase could show.
export type UpdatePhase =
  | 'idle'
  | 'available'
  /// Android 8+ requires "install unknown apps" per-app before the installer can be opened.
  | 'permission-needed'
  | 'downloading'
  | 'ready-to-install'
  | 'error';

export interface UpdateState {
  available: boolean;
  /// The running build can no longer talk to this server correctly, so carrying on is not an
  /// option. Only ever true when someone deliberately said so: a `[force-update]` line in the
  /// release tag, or MIN_CLIENT_BUILD_TIME pinned on the server.
  required: boolean;
  /// True inside the packaged Android app, where updating means downloading and installing a
  /// new APK rather than reloading the page.
  native: boolean;
  phase: UpdatePhase;
  progress: DownloadProgress | null;
  error: string | null;
  serverBuildId: string;
  /// What to call the new version, and what changed. Null until a release is published.
  release: ReleaseManifest | null;
  /// Advances the flow: reload on the web; download, then install, on Android.
  apply: () => void;
  /// Android only - opens the Settings screen that grants "install unknown apps".
  openPermissionSettings: () => void;
}

export function useAppUpdate(): UpdateState {
  const [server, setServer] = useState<ServerVersion | null>(null);
  const [installedCode, setInstalledCode] = useState<number | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apkPath, setApkPath] = useState<string | null>(null);

  const native = isNative();
  // Guards a re-check triggered by resume from clobbering a download the user is already in
  // the middle of - coming back from the installer screen fires resume too.
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (busy.current) return;
    try {
      setServer(await api<ServerVersion>('/version'));
    } catch {
      // Offline or the server is restarting mid-deploy. Not worth surfacing: the next check
      // will either find a new build or find nothing changed.
    }
  }, []);

  useEffect(() => {
    void installedVersionCode().then(setInstalledCode);
  }, []);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    // On Android the WebView's visibility events are not reliably delivered when the whole
    // task is backgrounded, so the native resume event is a separate signal, not a duplicate.
    const offResume = onAppResume(() => void check());
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      offResume();
    };
  }, [check]);

  const release = server?.release ?? null;

  // Two different questions, deliberately not shared.
  //
  // The web build asks "is the server's bundle newer than mine", because a browser has no
  // version of its own and a deploy is instantly available to it.
  //
  // The Android build must ask "is there a released APK with a higher versionCode than the
  // one installed". Using build time there would nag on every web deploy - including ones
  // with no APK behind them - and offer an update that cannot be delivered.
  const known = server !== null;
  const available = native
    ? known &&
      installedCode !== null &&
      release !== null &&
      typeof release.apkUrl === 'string' &&
      release.versionCode > installedCode
    : // A dev build (buildTime 0) never nags - otherwise `vite dev` would show an update
      // prompt against any real server it is pointed at.
      known && BUILD_TIME > 0 && server.buildTime > BUILD_TIME;

  const required = native
    ? available && release?.forceUpdate === true
    : known &&
      BUILD_TIME > 0 &&
      (BUILD_TIME < server.minClientBuildTime || (available && release?.forceUpdate === true));

  useEffect(() => {
    if (phase !== 'downloading') return;
    const handle = UpdateInstaller.addListener('downloadProgress', setProgress);
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [phase]);

  const applyWeb = useCallback(() => {
    // The user was already past the lock screen and just chose this, so re-asking for the PIN
    // on the other side of a reload is friction with no security value. One-shot, per tab.
    grantUnlock();
    // A plain reload is enough because index.html is served no-cache and every asset is
    // content-hashed (see backend/src/static.ts). localStorage survives, so the session,
    // theme and group all come back exactly as they were.
    window.location.reload();
  }, []);

  const applyNative = useCallback(async () => {
    if (!release?.apkUrl || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      // Installing without this permission fails at the system screen with nothing useful
      // said, so it is checked up front and turned into an instruction the user can act on.
      const { allowed } = await UpdateInstaller.canRequestPackageInstalls();
      if (!allowed) {
        setPhase('permission-needed');
        return;
      }

      // Already downloaded and verified once - go straight back to the installer rather than
      // pulling the same 5MB again because the user tapped away from the system prompt.
      if (apkPath) {
        await UpdateInstaller.installApk({ path: apkPath });
        return;
      }

      setProgress(null);
      setPhase('downloading');
      const { path } = await UpdateInstaller.downloadApk({
        url: release.apkUrl,
        expectedSha256: release.apkSha256,
      });
      setApkPath(path);
      setPhase('ready-to-install');
      await UpdateInstaller.installApk({ path });
      // Whether the install was completed is not observable from here. The next resume
      // re-runs the check, and a successful install means a new versionCode that no longer
      // matches - which is how the prompt actually goes away.
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : 'The update could not be installed.');
    } finally {
      busy.current = false;
    }
  }, [release, apkPath]);

  const apply = useCallback(() => {
    if (native) void applyNative();
    else applyWeb();
  }, [native, applyNative, applyWeb]);

  const openPermissionSettings = useCallback(() => {
    void UpdateInstaller.openInstallPermissionSettings().catch(() => {
      setError('Could not open the settings screen. Grant "install unknown apps" manually.');
    });
    // The grant happens outside the app, so the only sane next step is to let them tap Update
    // again when they come back.
    setPhase('available');
  }, []);

  return {
    available,
    required,
    native,
    phase: available && phase === 'idle' ? 'available' : phase,
    progress,
    error,
    serverBuildId: server?.buildId ?? BUILD_ID,
    release,
    apply,
    openPermissionSettings,
  };
}
