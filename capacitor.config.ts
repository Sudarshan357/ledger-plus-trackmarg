import type { CapacitorConfig } from '@capacitor/cli';

/*
 * Ledger+ Android app.
 *
 * The web build in dist/ is packaged INSIDE the APK. There is no server.url: the WebView
 * never loads a remote page, every screen is a local file, and the only thing that crosses
 * the network is fetch() to the API - which is what a native app calling a backend does, not
 * what a browser loading a website does. Same shape as mystio1/excavator-manager.
 *
 * That is a deliberate trade against the thin shell this replaced. The shell got every web
 * deploy for free, because it was only ever a URL; the cost was that it WAS only a URL - no
 * offline shell, no version of its own, nothing on the phone but a viewport. Bundling means
 * the phone runs a real build that Android can version, sign and update, and it means a new
 * build reaches the phone as a new APK rather than a page reload. See
 * android/.../UpdateInstallerPlugin.java for how that update is delivered in-app.
 *
 * The API address is baked into the JS at build time by VITE_API_URL (see src/api/client.ts),
 * not here - the native build has no origin of its own to resolve a relative /api against.
 */
const config: CapacitorConfig = {
  appId: 'com.trackmarg.ledgerplus',
  appName: 'Ledger+',
  webDir: 'dist',
  android: {
    // The web app draws its own dark hero and follows the system theme, so the native window
    // behind it should not flash white on launch.
    backgroundColor: '#0d1117',
  },
};

export default config;
