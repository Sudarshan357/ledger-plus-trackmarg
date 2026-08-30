/*
 * Publishes a release manifest, so an update prompt can say what actually changed.
 *
 *     git tag -a v1.0.1 -m "Dark theme" -m "Ledger search and date filter"
 *     git push origin v1.0.1
 *     npm run release
 *
 * Every line of the annotated tag message becomes one release-notes bullet. A line containing
 * exactly [force-update] makes the update mandatory - it is stripped from the notes shown to
 * users and only flips the flag. Convention taken from mystio1/excavator-manager, so the
 * Android build can reuse the same tags unchanged when it arrives.
 *
 * The manifest is published as a version.json asset on a GitHub Release in the PUBLIC
 * releases repo, which is why the server can read it with no credential at all while the
 * source repo stays private.
 *
 * Auth reuses the credential git already has for github.com - there is no separate token to
 * create or store.
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_REPO = process.env.GITHUB_RELEASE_REPO || 'Sudarshan357/ledger-plus-releases';

function git(args) {
  return execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/// Reuses the credential git already holds for github.com rather than asking for a token.
function githubToken() {
  try {
    const out = execSync('git -c credential.interactive=false credential fill', {
      cwd: root,
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const line = out.split('\n').find((l) => l.startsWith('password='));
    return line ? line.slice('password='.length).trim() : null;
  } catch {
    return null;
  }
}

async function gh(pathname, init = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ledger-plus-release',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

// ── Work out what we are releasing ──────────────────────────────────────────
const tag = process.argv[2] || (() => {
  try {
    // The most recent tag pointing at HEAD, so `npm run release` right after tagging just works.
    return git('describe --exact-match --tags HEAD');
  } catch {
    return '';
  }
})();

if (!tag) {
  fail(
    'No tag to release.\n\n' +
      '  git tag -a v1.0.1 -m "What changed" -m "Another line"\n' +
      '  git push origin v1.0.1\n' +
      '  npm run release\n\n' +
      'Or name one explicitly:  npm run release -- v1.0.1',
  );
}

const token = githubToken();
if (!token) fail('No stored GitHub credential found. Run a `git push` once so git saves one.');

const versionName = tag.replace(/^v/, '');
const commit = git(`rev-list -n 1 ${tag}`).slice(0, 7);

// Annotated tag message. A lightweight tag has none, and releasing one would silently publish
// the commit message as release notes - better to refuse and say why.
let message = '';
try {
  message = execSync(`git tag -l --format=%(contents) ${tag}`, { cwd: root, encoding: 'utf8' }).trim();
} catch {
  /* handled below */
}
if (!message) {
  fail(`Tag ${tag} has no annotated message, so there are no release notes to publish.\n` +
    `Re-tag with:  git tag -f -a ${tag} -m "What changed"`);
}

const forceUpdate = message.includes('[force-update]');
const releaseNotes = message
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.includes('[force-update]'));

// Strictly increasing, and derived from the tag rather than a counter, so re-running this
// never produces a lower number than an earlier release. v1.2.3 -> 1002003.
const parts = versionName.split('.').map((n) => parseInt(n, 10) || 0);
const versionCode = (parts[0] ?? 0) * 1_000_000 + (parts[1] ?? 0) * 1_000 + (parts[2] ?? 0);
if (versionCode <= 0) fail(`Cannot derive a version number from "${tag}". Use a tag like v1.0.1.`);

// ── Build the APK ───────────────────────────────────────────────────────────
//
// The Android app is packaged, not a shell around a URL, so a release is only real for phone
// users once there is an APK behind it. `--no-apk` skips this for a web-only change: the
// manifest then carries no apkUrl, and the app correctly offers nothing.
const APK_NAME = 'ledger-plus.apk';
const apkUrl = `https://github.com/${RELEASE_REPO}/releases/download/${tag}/${APK_NAME}`;

/// Signing credentials live outside the repo. Sourced here rather than expected in the shell,
/// so `npm run release` works from a plain terminal with nothing exported.
function loadSigningEnv() {
  const envFile = path.join(os.homedir(), '.ledger-plus', 'keystore.env');
  if (!fs.existsSync(envFile)) return false;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)="?([^"\n]*)"?\s*$/);
    if (m && m[1].startsWith('ANDROID_')) process.env[m[1]] = m[2];
  }

  // A path written from Git Bash comes out POSIX-style (/c/Users/...). Sourcing the file in
  // bash hides that, because MSYS rewrites it on the way into a Windows process - but read
  // here and handed to Gradle directly, it stays POSIX, and Gradle's file() does not see it
  // as absolute. It then resolves it against the module directory and reports a keystore
  // missing from a path that never existed.
  const keystore = process.env.ANDROID_KEYSTORE_PATH;
  if (keystore) {
    process.env.ANDROID_KEYSTORE_PATH = keystore.replace(/^\/([a-zA-Z])\//, (_, drive) => `${drive.toUpperCase()}:/`);
  }
  return Boolean(process.env.ANDROID_KEYSTORE_PATH);
}

let apkPath = null;
let apkSha256 = null;

if (!process.argv.includes('--no-apk')) {
  const signed = loadSigningEnv();
  if (!signed) {
    // Shipping a debug-signed APK to clients would be a trap, not a shortcut: Android refuses
    // to install an update whose signature differs from the installed app, so the first
    // properly-signed release would strand everyone who took this one.
    fail(
      'No signing keystore found at ~/.ledger-plus/keystore.env.\n\n' +
        'A release APK must be signed with the real key, or no future update can install\n' +
        'over it. Restore that folder from your backup, or release the manifest alone with:\n\n' +
        '  npm run release -- ' + tag + ' --no-apk',
    );
  }

  console.log(`Building signed APK for ${tag}...`);
  execSync(`node scripts/build-apk.mjs --release --version ${versionName} --code ${versionCode}`, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  apkPath = path.join(root, 'ledger-plus-release.apk');
  if (!fs.existsSync(apkPath)) fail('The APK build reported success but produced no file.');
  // The app checks the APK it downloaded against this hash before handing it to Android's
  // installer, so a truncated download fails with an honest message instead of "App not
  // installed".
  apkSha256 = crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
}

const manifest = {
  versionCode,
  versionName,
  releaseNotes: releaseNotes.length ? releaseNotes : ['Bug fixes and improvements.'],
  forceUpdate,
  commit,
  ...(apkSha256 ? { apkUrl, apkSha256 } : {}),
};

console.log(`\nReleasing ${tag} to ${RELEASE_REPO}`);
console.log(`  versionCode ${versionCode}${forceUpdate ? '   [MANDATORY UPDATE]' : ''}`);
console.log(`  APK ${apkSha256 ? `${(fs.statSync(apkPath).size / 1048576).toFixed(1)} MB` : 'none (manifest only)'}`);
for (const note of manifest.releaseNotes) console.log(`  • ${note}`);

// ── Publish ─────────────────────────────────────────────────────────────────
let release = await gh(`/repos/${RELEASE_REPO}/releases/tags/${tag}`);

if (!release.ok) {
  release = await gh(`/repos/${RELEASE_REPO}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name: `Ledger+ ${versionName}`,
      body: manifest.releaseNotes.map((n) => `- ${n}`).join('\n'),
      draft: false,
      prerelease: false,
    }),
  });
  if (!release.ok) {
    fail(`Could not create the release (HTTP ${release.status}): ${release.body?.message ?? 'unknown error'}`);
  }
  console.log(`  created release ${tag}`);
} else {
  console.log(`  release ${tag} already exists - replacing its manifest`);
}

// Replace any existing assets so re-running is safe rather than producing two with the same
// name, only one of which the server would find.
for (const asset of release.body.assets ?? []) {
  if (asset.name === 'version.json' || asset.name === APK_NAME) {
    await gh(`/repos/${RELEASE_REPO}/releases/assets/${asset.id}`, { method: 'DELETE' });
  }
}

const uploadUrl = String(release.body.upload_url).replace(/\{.*$/, '');

async function uploadAsset(name, body, contentType) {
  const res = await fetch(`${uploadUrl}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ledger-plus-release',
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body,
  });
  if (!res.ok) fail(`Could not upload ${name} (HTTP ${res.status}): ${await res.text()}`);
  console.log(`  uploaded ${name}`);
}

// APK first. version.json is what the app reads, and it names an apkUrl - publishing the
// manifest before the file it points at would leave a window where every phone is told an
// update exists and every download 404s.
if (apkPath) {
  await uploadAsset(APK_NAME, fs.readFileSync(apkPath), 'application/vnd.android.package-archive');
}
await uploadAsset('version.json', JSON.stringify(manifest, null, 2), 'application/json');

console.log(`\nPublished. ${release.body.html_url}`);
if (apkSha256) {
  console.log('Phones will offer this as an in-app update; browsers will offer a reload.');
} else {
  console.log('Manifest only - browsers will offer a reload, phones will see no new version.');
}
