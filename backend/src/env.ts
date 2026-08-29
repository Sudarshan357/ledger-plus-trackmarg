// Must be the first thing imported anywhere in the backend - every other module that reads
// process.env (notably the Prisma client, which reads DATABASE_URL when it is constructed)
// depends on dotenv having already run. index.ts imports this before anything else.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(backendRoot, '..');
const dataDir = path.join(backendRoot, 'data');

// Only used when SESSION_SECRET is not set. In this project it always IS set, because Ledger+
// shares the Trackmarg secret on purpose (see .env) - this fallback exists so a fresh clone
// without credentials still boots instead of crashing.
function readOrCreateLocalSessionSecret(): string {
  const secretPath = path.join(dataDir, '.session_secret');
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    return fs.readFileSync(secretPath, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, secret);
    return secret;
  }
}

/// The stamp written by scripts/build-info.mjs. Read once at boot: the running process is
/// serving one particular build and that does not change while it lives.
function readBuildInfo(): { buildId: string; buildTime: number; branch: string } {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'build-info.json'), 'utf8'));
  } catch {
    return { buildId: 'dev', buildTime: 0, branch: 'unknown' };
  }
}

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  isProduction: process.env.NODE_ENV === 'production',
  databaseUrl: process.env.DATABASE_URL,
  directUrl: process.env.DIRECT_URL,
  sessionSecret: process.env.SESSION_SECRET || readOrCreateLocalSessionSecret(),
  // Master password for the cross-tenant support console. Unset by default, which disables
  // the feature outright (every /api/support route 404s) rather than shipping a back door
  // nobody deliberately turned on. Deliberately a DIFFERENT variable from the transport app's
  // SUPPORT_ACCESS_PASSWORD, so the two consoles never share a credential.
  supportPassword: process.env.LEDGER_SUPPORT_PASSWORD || '',
  build: readBuildInfo(),
  // Where release manifests are published. A separate PUBLIC repo, so the app can read
  // version.json with no credential while the source repo stays private.
  releaseRepo: process.env.GITHUB_RELEASE_REPO || '',
  // Only needed if the release repo is private, or to lift GitHub's 60-per-hour
  // unauthenticated rate limit. Optional by design.
  githubApiToken: process.env.GITHUB_API_TOKEN || '',
  // Clients built before this instant must update before they can carry on. Left at 0, every
  // update is optional and an old client keeps working - which is the normal case, because
  // migrations here are additive. Set it (epoch ms) only when a server change genuinely
  // breaks older clients; see CLOUDFLARE.md and the README for the rule.
  minClientBuildTime: Number(process.env.MIN_CLIENT_BUILD_TIME || 0),
  backendRoot,
  projectRoot,
  dataDir,
  distDir: path.join(projectRoot, 'dist'),
};
