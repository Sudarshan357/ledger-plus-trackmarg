/*
 * Builds the Android APK.
 *
 *     npm run apk
 *
 * The APK is a THIN SHELL - an icon, a name, and a URL. It carries no screens of its own and
 * loads Ledger+ from the server, which is what makes `git push` reach the phone: a web deploy
 * updates the app the same second, with no new APK and no reinstall.
 *
 * Because the URL is baked in at build time it has to be a permanent one. That is what
 * ledger.trackmarg.in is for; a trycloudflare.com address changes on every restart and would
 * leave the installed app pointing at nothing.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = process.env.LEDGER_APP_URL || 'https://ledger.trackmarg.in';

// Android Studio ships its own JDK and it is the only one on this machine. Gradle needs it
// pointed at explicitly, because JAVA_HOME is not set system-wide here.
const JAVA_HOME = process.env.JAVA_HOME || 'C:\\Program Files\\Android\\Android Studio\\jbr';
const ANDROID_HOME =
  process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');

if (!fs.existsSync(JAVA_HOME)) {
  console.error(`No JDK at ${JAVA_HOME}. Set JAVA_HOME to one, or install Android Studio.`);
  process.exit(1);
}
if (!fs.existsSync(ANDROID_HOME)) {
  console.error(`No Android SDK at ${ANDROID_HOME}. Set ANDROID_HOME.`);
  process.exit(1);
}

const env = { ...process.env, JAVA_HOME, ANDROID_HOME, LEDGER_APP_URL: APP_URL };
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit', env, shell: true });

// Gradle reads sdk.dir from a Java .properties file, where a backslash escapes - so a Windows
// path needs every separator doubled or the location comes out mangled.
fs.writeFileSync(
  path.join(root, 'android', 'local.properties'),
  `sdk.dir=${ANDROID_HOME.split(path.sep).join('\\\\')}\n`,
);

console.log(`\nBuilding Ledger+ APK against ${APP_URL}\n`);

// `dist/` must exist: Capacitor copies it in as the fallback bundle and sync fails without it.
if (!fs.existsSync(path.join(root, 'dist'))) run('npm run build');

run('npx cap sync android');
run('gradlew.bat assembleDebug', path.join(root, 'android'));

const built = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const out = path.join(root, 'ledger-plus.apk');
fs.copyFileSync(built, out);

const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`\nledger-plus.apk  ${mb} MB  ->  ${APP_URL}`);
console.log('Copy it to the phone and open it. Allow "install from unknown sources" when asked.');
