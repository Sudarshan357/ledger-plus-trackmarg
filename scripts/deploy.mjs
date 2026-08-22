/*
 * One command to put a pushed commit in front of users: `npm run deploy`.
 *
 * A commit does NOT reach anyone by itself, and neither does a push. The update prompt is
 * driven by GET /api/version, which reports the build the SERVER is running - and the server
 * only learns about a new commit when the code is pulled, rebuilt and restarted here. This
 * script is that step, in the right order:
 *
 *     pull  ->  install (only if deps moved)  ->  migrate  ->  build  ->  restart
 *
 * Migrations run BEFORE the build goes live, deliberately. They are additive, so the currently
 * running old code keeps working against the migrated database while the build happens - and
 * new code never starts against a database that has not caught up.
 *
 *   npm run deploy              pull, migrate, build, and tell you to restart
 *   npm run deploy -- --restart also stop the running server and start the new build
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const restart = process.argv.includes('--restart');

function run(cmd, { capture = false } = {}) {
  return execSync(cmd, {
    cwd: root,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
}

function step(label) {
  console.log(`\n[36m→ ${label}[0m`);
}

const before = run('git rev-parse HEAD', { capture: true }).trim();
// Hashing the lockfile rather than trusting `git diff` means a dependency change is caught
// even if it arrived some other way.
const lockBefore = fs.existsSync(path.join(root, 'package-lock.json'))
  ? fs.statSync(path.join(root, 'package-lock.json')).mtimeMs
  : 0;

step('Pulling from GitHub');
try {
  run('git pull --ff-only');
} catch {
  console.error(
    '\nPull failed. Most often this is local changes that were never committed, or a branch\n' +
      'that has diverged. Sort that out first - deploying a half-merged tree is worse than not\n' +
      'deploying at all.',
  );
  process.exit(1);
}

const after = run('git rev-parse HEAD', { capture: true }).trim();
if (before === after) {
  console.log('  Already on the latest commit. Rebuilding anyway so the running server matches it.');
} else {
  console.log(`  ${before.slice(0, 7)} -> ${after.slice(0, 7)}`);
}

const lockAfter = fs.existsSync(path.join(root, 'package-lock.json'))
  ? fs.statSync(path.join(root, 'package-lock.json')).mtimeMs
  : 0;
if (lockAfter !== lockBefore) {
  step('Dependencies changed - installing');
  run('npm install --no-audit --no-fund');
}

step('Applying database migrations');
// Additive by rule (see the README), so this is safe to run while the old build is still
// serving traffic. If a migration fails, nothing below runs and the old build stays up.
run('npm run db:migrate');

step('Building');
run('npm run build');
run('npm run build:backend');

const info = JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8'));

if (!restart) {
  console.log(
    `\n[32mBuilt ${info.buildId} (${info.branch}).[0m\n` +
      'Restart the server for clients to see it:  node backend/dist/index.js\n' +
      '(or re-run with --restart to do it here)',
  );
  process.exit(0);
}

step('Restarting the server');
// The old process holds the port; a new one would just fail to bind, which is exactly how a
// deploy silently does not happen.
const port = Number(process.env.PORT || 4000);
try {
  execSync(
    `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen ` +
      `-ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force ` +
      `-ErrorAction SilentlyContinue }"`,
    { stdio: 'ignore' },
  );
} catch {
  /* nothing was listening */
}

const child = spawn(process.execPath, [path.join(root, 'backend', 'dist', 'index.js')], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
});
child.unref();

console.log(
  `\n[32mDeployed ${info.buildId} (${info.branch}).[0m\n` +
    'Every client still on an older build will now see "Update available".',
);
