import { config } from '../env.js';

/*
 * The release manifest: what version this is called, what changed, and whether the update is
 * optional. Modelled on mystio1/excavator-manager's app-version flow.
 *
 * The build stamp (build-info.json) already answers "is the server newer than this client" -
 * that is a fact about bytes and it is what actually triggers the prompt. This answers the
 * questions the build stamp cannot: a commit hash is not a version name, and "9773129 is
 * available" tells a partner nothing about whether to care. Releases carry the human half.
 *
 * apkUrl/apkSha256 are carried through unused for now. They are what the Android build will
 * need when it lands, and having the server already serve them means that step is a client
 * change only.
 */

export interface AppVersionManifest {
  /// Strictly increasing integer. The authoritative comparison value for a native build,
  /// where a version NAME is only a label.
  versionCode: number;
  versionName: string;
  releaseNotes: string[];
  forceUpdate: boolean;
  apkUrl?: string;
  apkSha256?: string;
}

/// Hand-validated rather than pulling in a schema library for one shape. A malformed manifest
/// must be treated as "no manifest" and never as a partial one - half a release notice is
/// worse than none.
function parseManifest(value: unknown): AppVersionManifest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  const versionCode = Number(raw.versionCode);
  if (!Number.isInteger(versionCode) || versionCode <= 0) return null;

  const versionName = typeof raw.versionName === 'string' ? raw.versionName.trim() : '';
  if (!versionName) return null;

  const notes = Array.isArray(raw.releaseNotes)
    ? raw.releaseNotes.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    : [];

  const apkSha256 = typeof raw.apkSha256 === 'string' && /^[0-9a-f]{64}$/i.test(raw.apkSha256)
    ? raw.apkSha256
    : undefined;

  return {
    versionCode,
    versionName,
    releaseNotes: notes,
    forceUpdate: raw.forceUpdate === true,
    apkUrl: typeof raw.apkUrl === 'string' && raw.apkUrl.startsWith('https://') ? raw.apkUrl : undefined,
    apkSha256,
  };
}

// GitHub allows 60 unauthenticated calls an hour. Every client asks for this on launch, on
// resume, and every 15 minutes, so it is cached here rather than fetched per request - two
// calls per refresh at this TTL is 60 an hour at the very worst.
const TTL_MS = 2 * 60 * 1000;
let cached: { at: number; manifest: AppVersionManifest | null } | null = null;

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: abort.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ledger-plus',
        // Only needed for a private release repo, or to lift the rate limit. The releases
        // repo is public precisely so this is optional.
        ...(config.githubApiToken ? { Authorization: `Bearer ${config.githubApiToken}` } : {}),
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Offline, GitHub down, or slow. The app must keep working: a missing manifest just means
    // the update prompt falls back to showing the build id with no notes.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/// The latest published release's version.json, or null if there is none, it is unreadable,
/// or releases are not configured. Never throws.
export async function getAppVersion(): Promise<AppVersionManifest | null> {
  if (!config.releaseRepo) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.manifest;

  const release = (await fetchJson(
    `https://api.github.com/repos/${config.releaseRepo}/releases/latest`,
  )) as { assets?: Array<{ name?: string; browser_download_url?: string }> } | null;

  const asset = release?.assets?.find((a) => a.name === 'version.json');
  const manifest = asset?.browser_download_url
    ? parseManifest(await fetchJson(asset.browser_download_url))
    : null;

  // Cached even when null, so a repo with no releases yet does not mean two GitHub calls on
  // every single version check.
  cached = { at: Date.now(), manifest };
  return manifest;
}
