/*
 * Turns `git push` into a live deploy, with nothing to run by hand.
 *
 *     npm run watch
 *
 * Polls GitHub for a new commit on this branch and, when one appears, runs the same
 * `npm run deploy -- --restart` you would have run yourself. Every client then sees
 * "Update available" on its next version check.
 *
 * Polling rather than a GitHub webhook, deliberately: a webhook needs GitHub to be able to
 * reach THIS machine, which behind CGNAT means a permanent public hostname. Polling needs
 * nothing inbound and works today. Once there is a domain-backed Cloudflare Tunnel, a webhook
 * is worth swapping in - it turns a minute into a second.
 *
 * `git ls-remote` is used rather than the GitHub API so this needs no token of its own: it
 * reuses the credential git already has.
 */
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTERVAL_MS = Math.max(30, Number(process.env.WATCH_INTERVAL_SECONDS || 60)) * 1000;

function git(args) {
  return execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function stamp() {
  return new Date().toLocaleTimeString('en-IN', { hour12: false });
}

function log(message) {
  console.log(`[${stamp()}] ${message}`);
}

const branch = git('rev-parse --abbrev-ref HEAD');
log(`Watching origin/${branch} every ${INTERVAL_MS / 1000}s. Push to deploy.`);

let deploying = false;

async function tick() {
  // A deploy takes longer than the poll interval, and starting a second one on top of it
  // would have two processes fighting over the port and the build directory.
  if (deploying) return;

  let remote;
  try {
    // Asks GitHub for the branch tip without fetching any objects.
    remote = git(`ls-remote origin refs/heads/${branch}`).split(/\s+/)[0];
  } catch {
    // Laptop asleep, wifi dropped, GitHub having a moment. Not worth reporting every minute -
    // the next tick either works or it does not.
    return;
  }
  if (!remote) return;

  const local = git('rev-parse HEAD');
  if (remote === local) return;

  deploying = true;
  log(`New commit ${remote.slice(0, 7)} on origin/${branch} - deploying`);

  // Run deploy as a child rather than importing it: a build failure then kills only the
  // deploy, and this watcher keeps going instead of dying on a bad push.
  const result = spawnSync('npm', ['run', 'deploy', '--', '--restart'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });

  if (result.status === 0) {
    log(`Deployed ${git('rev-parse --short HEAD')}. Clients will be offered the update.`);
  } else {
    // deploy.mjs only restarts AFTER a successful build, so a failure here means the previous
    // build is still serving. Saying so matters - "deploy failed" and "the app is down" are
    // very different things at 11pm.
    log('Deploy FAILED. The previous build is still running and serving normally.');
    log('Fix the problem, push again, and this will pick it up.');
  }
  deploying = false;
}

await tick();
setInterval(() => void tick(), INTERVAL_MS);
