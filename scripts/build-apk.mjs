/*
 * Builds the Android APK.
 *
 *     npm run apk                          debug build, for sideloading onto your own phone
 *     npm run apk -- --release             signed release build (needs a keystore, see below)
 *     npm run apk -- --release --version 1.0.4 --code 4
 *
 * The web build is packaged INSIDE the APK - this is a real app, not a shell around a URL.
 * See capacitor.config.ts for why, and for what that trades away.
 *
 * SIGNING. Android identifies an app by its signature, so an update only installs over an
 * existing app when both were signed by the SAME key. That makes the keystore the single
 * thing here that cannot be regenerated: lose it and every installed copy has to be
 * uninstalled by hand before it can be updated again. It lives outside the repo, and
 * scripts/release.mjs passes it in through the environment:
 *
 *     ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
 *
 * With none of those set, a release build falls back to the debug key - fine for trying it
 * out, not fine for anything a client installs.
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const isRelease = flag('release');
const versionName = value('version');
const versionCode = value('code');

// Where the packaged app should look for the API. It has no origin of its own to resolve a
// relative /api against, so this is baked into the JS at build time.
const API_URL = (process.env.LEDGER_API_URL || 'https://ledger.trackmarg.in').replace(/\/$/, '');

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

const env = { ...process.env, JAVA_HOME, ANDROID_HOME, VITE_NATIVE_API_URL: API_URL };
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit', env, shell: true });

// Gradle reads sdk.dir from a Java .properties file, where a backslash escapes - so a Windows
// path needs every separator doubled or the location comes out mangled.
fs.writeFileSync(
  path.join(root, 'android', 'local.properties'),
  `sdk.dir=${ANDROID_HOME.split(path.sep).join('\\\\')}\n`,
);

console.log(`\nBuilding Ledger+ ${isRelease ? 'release' : 'debug'} APK`);
console.log(`API: ${API_URL}`);
if (isRelease) {
  const signed = Boolean(process.env.ANDROID_KEYSTORE_PATH);
  console.log(`Signing: ${signed ? 'release keystore' : 'DEBUG KEY (not for distribution)'}`);
}
if (versionName) console.log(`Version: ${versionName} (code ${versionCode ?? 'unset'})`);
console.log('');

// Always rebuilt, never reused. The bundle carries VITE_NATIVE_API_URL baked in, so a dist/
// left over from a plain `npm run build` would ship an app with no API address at all.
run('npm run build');

// Absolute path, not the bare name. cmd.exe will not always resolve an executable out of the
// working directory - `NoDefaultCurrentDirectoryInExePath` turns that off, and it is off on
// this machine - so `gradlew.bat` alone fails with "not recognized" even standing in android/.
// cwd still has to be android/, because that is how Gradle finds the project.
const gradlew = process.platform === 'win32'
  ? `"${path.join(root, 'android', 'gradlew.bat')}"`
  : './gradlew';

run('npx cap sync android');

const task = isRelease ? 'assembleRelease' : 'assembleDebug';
const props = [
  versionCode ? `-PversionCode=${versionCode}` : '',
  versionName ? `-PversionName=${versionName}` : '',
].filter(Boolean).join(' ');
run(`${gradlew} ${task} ${props}`.trim(), path.join(root, 'android'));

const variant = isRelease ? 'release' : 'debug';
const built = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
const out = path.join(root, isRelease ? 'ledger-plus-release.apk' : 'ledger-plus.apk');
fs.copyFileSync(built, out);

// Printed because the release manifest has to carry it: the plugin checks the APK it
// downloaded against this before handing it to the installer.
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);

console.log(`\n${path.basename(out)}  ${mb} MB`);
console.log(`sha256  ${sha256}`);
if (!isRelease) {
  console.log('\nCopy it to the phone and open it. Allow "install from unknown sources" when asked.');
}
