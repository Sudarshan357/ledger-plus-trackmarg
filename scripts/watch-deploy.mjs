/*
 * Turns a commit into a live deploy, with nothing to run by hand.
 *
 *     npm run watch
 *
 * Checks whether the RUNNING BUILD is behind the code and, when it is, runs the same
 * `npm run deploy -- --restart` you would have run yourself. Every client then sees
 * "Update available" on its next version check.
 *
 * The comparison is deliberately "built commit vs. latest commit", not "local vs. remote".
 * Those look equivalent and are not: if you commit and push from the same folder that serves
 * the app - which is exactly this setup - local and remote match the instant you push, so a
 * local-vs-remote watcher would never fire even though the running build is stale. Comparing
 * against what was actually built is correct whether the serving copy is the machine you work
 * on or a separate one.
 *
 * Polling rather than a GitHub webhook: a webhook needs GitHub to reach THIS machine, which
 * behind CGNAT means a permanent public hostname. Polling needs nothing inbound and works
 * today. Worth swapping once the Cloudflare Tunnel is domain-backed - it turns a minute into
 * a second.
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { EOL } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTERVAL_MS = Math.max(30, Number(process.env.WATCH_INTERVAL_SECONDS || 60)) * 1000;

function git(args) {
  return execSync(`git ${args}`, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  }).trim();
}

/// Written synchronously to fd 1 rather than via console.log.
///
/// Node block-buffers stdout when it is redirected to a file instead of a terminal, so a
/// long-running watcher's lines sat unflushed in a 64KB buffer - the log stayed empty through
/// a deploy that had plainly happened. A log you cannot trust when you are not watching is
/// worse than no log, because it looks like the watcher is doing nothing.
function log(message) {
  const at = new Date().toLocaleTimeString('en-IN', { hour12: false });
  fs.writeSync(1, `[${at}] ${message}${EOL}`);
}

/// The commit the currently-built bundle was made from. `npm run build` writes this.
function builtCommit() {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8'));
    // A dirty build is stamped "abc1234+dev"; only the commit part is comparable.
    return String(info.buildId).split('+')[0];
  } catch {
    return null;
  }
}

const branch = git('rev-parse --abbrev-ref HEAD');
log(`Watching ${branch} every ${INTERVAL_MS / 1000}s. Commit or push to deploy.`);

let deploying = false;
let failedAt = null; // commit that failed to deploy - not retried until something new arrives
let quiet = false; // suppresses repeated network-failure noise

async function tick() {
  // A deploy outlasts the poll interval, and a second one on top would have two processes
  // fighting over the port and the build directory.
  if (deploying) return;

  let latest;
  try {
    // Bring the remote's commits in without touching the working tree, so a push from
    // elsewhere is seen too. Then take whichever of local/remote is actually newest.
    git(`fetch --quiet origin ${branch}`);
    const local = git('rev-parse HEAD');
    let ahead = 0;
    try {
      // How many commits the remote has that we do not. Counting rather than
      // `merge-base --is-ancestor`, which reports through its exit code - and a non-zero exit
      // from execSync throws, which would be caught below and misread as a network failure.
      ahead = Number(git(`rev-list --count HEAD..origin/${branch}`)) || 0;
    } catch {
      /* branch not pushed yet - local is all there is */
    }
    latest = ahead > 0 ? git(`rev-parse origin/${branch}`) : local;
    if (quiet) {
      log('Reconnected.');
      quiet = false;
    }
  } catch {
    if (!quiet) {
      log('Cannot reach the remote right now - will keep trying quietly.');
      quiet = true;
    }
    return;
  }

  const built = builtCommit();
  if (built && latest.startsWith(built)) return;
  if (failedAt && latest.startsWith(failedAt)) return;

  deploying = true;
  log(`Running build is ${built ?? 'unknown'}, code is at ${latest.slice(0, 7)} - deploying`);

  // A child process, so a bad commit fails the deploy without taking the watcher down too.
  const result = spawnSync('npm', ['run', 'deploy', '--', '--restart'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });

  if (result.status === 0) {
    failedAt = null;
    log(`Deployed ${builtCommit()}. Clients will be offered the update.`);
  } else {
    // deploy only restarts AFTER a successful build, so the previous build is still serving.
    // Saying so matters: "the deploy failed" and "the app is down" are very different things.
    failedAt = latest.slice(0, 7);
    log('Deploy FAILED. The previous build is still running and serving normally.');
    log(`Not retrying ${failedAt}. Fix it, commit again, and this will pick that up.`);
  }
  deploying = false;
}

await tick();
setInterval(() => void tick(), INTERVAL_MS);
