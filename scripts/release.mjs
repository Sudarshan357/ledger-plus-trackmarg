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

const manifest = {
  versionCode,
  versionName,
  releaseNotes: releaseNotes.length ? releaseNotes : ['Bug fixes and improvements.'],
  forceUpdate,
  commit,
};

console.log(`Releasing ${tag} to ${RELEASE_REPO}`);
console.log(`  versionCode ${versionCode}${forceUpdate ? '   [MANDATORY UPDATE]' : ''}`);
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

// Replace any existing version.json so re-running is safe rather than producing two assets
// with the same name, only one of which the server would find.
for (const asset of release.body.assets ?? []) {
  if (asset.name === 'version.json') {
    await gh(`/repos/${RELEASE_REPO}/releases/assets/${asset.id}`, { method: 'DELETE' });
  }
}

const uploadUrl = String(release.body.upload_url).replace(/\{.*$/, '');
const upload = await fetch(`${uploadUrl}?name=version.json`, {
  method: 'POST',
  headers: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ledger-plus-release',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(manifest, null, 2),
});

if (!upload.ok) {
  fail(`Could not upload version.json (HTTP ${upload.status}): ${await upload.text()}`);
}

console.log(`\nPublished. ${release.body.html_url}`);
console.log('Clients will show these notes with their next update prompt.');
