/*
 * Stamps each build with an identity, written to build-info.json at the project root.
 *
 * Both halves of the app read this one file - Vite bakes it into the client bundle at build
 * time, and the Express server reads it at boot to answer GET /api/version. That is what lets
 * a running client notice that the server it is talking to has moved on.
 *
 * Run exactly ONCE per deploy (see the `build` / `start` scripts). Running it again between
 * building the frontend and starting the server would give the two different timestamps, and
 * every client would be told there is an update that does not exist.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args, fallback = '') {
  try {
    return execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // No git, no commits yet, or git not on PATH - none of which should fail a build.
    return fallback;
  }
}

const buildTime = Date.now();
const commit = git('rev-parse --short HEAD');
const branch = git('rev-parse --abbrev-ref HEAD', 'unknown');
// Uncommitted changes are marked, so a build made from a dirty tree is never mistaken for the
// commit it was nearly made from.
const dirty = git('status --porcelain') !== '';

const info = {
  // Shown to people. The commit is what ties a running app back to the code that made it.
  buildId: commit ? `${commit}${dirty ? '+dev' : ''}` : `dev-${buildTime}`,
  branch,
  // Compared, not shown. Ordering by commit hash is impossible; ordering by build time is
  // trivial and is all the client needs to answer "is the server newer than me".
  buildTime,
};

fs.writeFileSync(path.join(root, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`build ${info.buildId} (${info.branch}) at ${new Date(buildTime).toISOString()}`);
