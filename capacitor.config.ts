import type { CapacitorConfig } from '@capacitor/cli';

/*
 * Ledger+ Android shell.
 *
 * This is a THIN shell: the APK carries an icon, a name and a URL, and loads the real app from
 * the server. That is deliberate, and it is what makes "push once, web and app both" actually
 * true - every web deploy reaches the phone the same second, with no new APK, no Play Store
 * review and no reinstall.
 *
 * The alternative, packaging the web build inside the APK, would break the update prompt
 * outright: tapping Update calls location.reload(), which on a bundled app reloads the same
 * local file, so the bar would reappear forever with no way to satisfy it. Making updates work
 * from a bundled APK needs the whole native OTA apparatus - signing keystore, release
 * workflow, installer plugin - which is a much larger thing than this.
 *
 * The cost is that `server.url` is baked in at build time. It must therefore be a STABLE
 * address: a domain-backed Cloudflare Tunnel, never a throwaway trycloudflare.com URL, which
 * changes on every restart and would leave the APK pointing at nothing.
 */
const SERVER_URL = process.env.LEDGER_APP_URL || 'https://REPLACE-ME.example.com';

const config: CapacitorConfig = {
  appId: 'com.trackmarg.ledgerplus',
  appName: 'Ledger+',
  // Still required even though the shell loads a remote URL: Capacitor copies this in as the
  // fallback bundle, and `npx cap sync` fails without it.
  webDir: 'dist',
  server: {
    url: SERVER_URL,
    // HTTPS only. The app carries session tokens and PINs; allowing cleartext would let a
    // hostile network on a phone read them.
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    // The web app already draws its own dark hero and respects the system theme, so the
    // native splash should not flash white before it appears.
    backgroundColor: '#0d1117',
  },
};

export default config;
