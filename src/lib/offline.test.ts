import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The offline path is the one nobody exercises by hand - you would have to put a phone in a
 * tunnel to see it. It is also the one that decides whether a wrong PIN gets into someone's
 * books, so it is tested directly.
 */

// Node has no DOM. A Map-backed stand-in is enough: the module only ever uses these three.
function installStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

vi.stubGlobal('crypto', webcrypto);

const {
  clearOfflineData,
  hasPinVerifier,
  loadSnapshot,
  offlineLockoutRemaining,
  savePinVerifier,
  saveSnapshot,
  tryOfflineUnlock,
} = await import('./offline');

describe('offline snapshot', () => {
  beforeEach(() => installStorage());

  it('round-trips the cached ledger with the user it belongs to', () => {
    saveSnapshot('user-1', { total: 4200 });
    const snap = loadSnapshot<{ total: number }>();
    expect(snap?.userId).toBe('user-1');
    expect(snap?.data.total).toBe(4200);
    expect(snap?.at).toBeGreaterThan(0);
  });

  it('has nothing to offer before a first sync', () => {
    expect(loadSnapshot()).toBeNull();
  });

  it('drops the previous partner\'s figures on logout', async () => {
    saveSnapshot('user-1', { total: 4200 });
    await savePinVerifier('1234');
    clearOfflineData();
    expect(loadSnapshot()).toBeNull();
    expect(hasPinVerifier()).toBe(false);
  });

  it('survives a corrupted entry rather than throwing into the boot path', () => {
    localStorage.setItem('ledgerplus.snapshot', '{ not json');
    expect(loadSnapshot()).toBeNull();
  });
});

describe('offline unlock', () => {
  beforeEach(() => installStorage());

  it('accepts the PIN the server accepted', async () => {
    await savePinVerifier('4821');
    expect(await tryOfflineUnlock('4821')).toBe('ok');
  });

  it('rejects any other PIN', async () => {
    await savePinVerifier('4821');
    expect(await tryOfflineUnlock('4822')).toBe('wrong-pin');
    expect(await tryOfflineUnlock('0000')).toBe('wrong-pin');
  });

  it('stores a verifier, never the PIN', async () => {
    await savePinVerifier('4821');
    const raw = localStorage.getItem('ledgerplus.pinCheck') ?? '';
    expect(raw).not.toContain('4821');
    // Stored JSON-encoded, like everything else the module writes.
    const stored = JSON.parse(raw) as string;
    // salt:hash, both hex, 16-byte salt and a 256-bit derived key.
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it('salts per device, so the same PIN does not produce the same verifier', async () => {
    await savePinVerifier('4821');
    const first = localStorage.getItem('ledgerplus.pinCheck');
    installStorage();
    await savePinVerifier('4821');
    expect(localStorage.getItem('ledgerplus.pinCheck')).not.toBe(first);
  });

  it('cannot be used before an online unlock has ever happened', async () => {
    expect(await tryOfflineUnlock('4821')).toBe('unavailable');
  });

  it('locks out after repeated wrong guesses, and says so', async () => {
    await savePinVerifier('4821');
    for (let i = 0; i < 4; i++) expect(await tryOfflineUnlock('0000')).toBe('wrong-pin');
    // The fifth failure trips it, and the lockout then applies to every further attempt -
    // including, deliberately, the correct PIN.
    expect(await tryOfflineUnlock('0000')).toBe('locked-out');
    expect(await tryOfflineUnlock('4821')).toBe('locked-out');
    expect(offlineLockoutRemaining()).toBeGreaterThan(0);
  });

  it('forgets earlier failures once the right PIN is entered', async () => {
    await savePinVerifier('4821');
    expect(await tryOfflineUnlock('0000')).toBe('wrong-pin');
    expect(await tryOfflineUnlock('0000')).toBe('wrong-pin');
    expect(await tryOfflineUnlock('4821')).toBe('ok');
    // Counter reset: four more wrong guesses must not trip a lockout.
    for (let i = 0; i < 4; i++) expect(await tryOfflineUnlock('0000')).toBe('wrong-pin');
    expect(offlineLockoutRemaining()).toBe(0);
  });
});
