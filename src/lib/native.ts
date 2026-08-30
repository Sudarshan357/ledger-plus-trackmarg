import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/*
 * The bridge to the Android build.
 *
 * Everything here is Android-only. The very same bundle also runs in an ordinary browser and
 * over the tunnel, so every call site must be behind `isNative()` - an unguarded call to a
 * plugin with no web implementation rejects, and a failed update check must never be allowed
 * to affect normal use of the app.
 */

/// True only inside the packaged Android app. False in every browser, including a phone
/// browser pointed at ledger.trackmarg.in, which looks identical to the user but has no
/// plugins and updates by reloading instead.
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export interface DownloadProgress {
  bytesWritten: number;
  totalBytes: number;
  /// -1 when the server sent no Content-Length, so the bar must be indeterminate.
  percent: number;
}

export interface UpdateInstallerPlugin {
  /// Streams the APK to app-private storage, checking its SHA-256 when one is given.
  downloadApk(options: { url: string; expectedSha256?: string }): Promise<{ path: string }>;
  /// Opens Android's own installer confirmation screen for an already-downloaded APK.
  installApk(options: { path: string }): Promise<{ started: boolean }>;
  /// Whether "install unknown apps" is granted to this app. Always true below Android 8.
  canRequestPackageInstalls(): Promise<{ allowed: boolean }>;
  /// Deep-links to the Settings screen where that permission is granted.
  openInstallPermissionSettings(): Promise<void>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (data: DownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

export const UpdateInstaller = registerPlugin<UpdateInstallerPlugin>('UpdateInstaller');

/// The installed build's versionCode, as an integer, or null off-native.
///
/// This is the authoritative "which version am I" for the app. The web build compares build
/// timestamps instead, because a browser has no package to ask - but on Android the package
/// manager knows, and it cannot be fooled by a stale cache the way a JS constant could.
export async function installedVersionCode(): Promise<number | null> {
  if (!isNative()) return null;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    const code = parseInt(info.build, 10);
    return Number.isNaN(code) ? null : code;
  } catch {
    return null;
  }
}

/// Runs `fn` whenever the app returns to the foreground. No-op off-native; returns a cleanup.
///
/// Worth having separately from visibilitychange: on Android the WebView's visibility events
/// are not reliably delivered when the whole task is backgrounded, and coming back from the
/// system installer is exactly the moment an update check needs to re-run.
export function onAppResume(fn: () => void): () => void {
  if (!isNative()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let cancelled = false;
  void (async () => {
    try {
      const { App } = await import('@capacitor/app');
      const h = await App.addListener('resume', fn);
      if (cancelled) void h.remove();
      else handle = h;
    } catch {
      /* plugin unavailable - the polling check still covers this */
    }
  })();
  return () => {
    cancelled = true;
    void handle?.remove();
  };
}
