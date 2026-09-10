import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Where the "Back to TrackMarg" button points. The button itself always shows - see
 * trackmargReturnUrl - so the only question these cover is the destination, and that is the
 * whole security surface of the feature.
 *
 * An unvalidated ?return= is an open redirect, and an open redirect on a SIGN-IN screen is the
 * most valuable kind there is: the victim follows a link on the real ledger.trackmarg.in, sees
 * the real sign-in page, taps a button reading "Back to TrackMarg" and lands on an attacker's
 * copy - having just been taught that this exact flow is normal. Nobody would catch that by
 * clicking around, so it is tested directly.
 */

const HUB = 'https://trackmarg.in';

/// Node has no DOM, and the module reads only this.
function visit(search = '') {
  vi.stubGlobal('window', { location: { search, hostname: 'ledger.trackmarg.in' } });
}

const { trackmargReturnUrl, TRACKMARG_HUB_URL } = await import('./trackmarg');

describe('where back goes', () => {
  beforeEach(() => visit());

  it('falls back to the hub when nothing specific was asked for', () => {
    expect(trackmargReturnUrl()).toBe(TRACKMARG_HUB_URL);
  });

  it('still answers with no query string at all - the packaged app has none', () => {
    // The Android build loads https://localhost/ with no search and no referrer. An earlier
    // version returned null here, which made the button dead code in the one place it is
    // most needed.
    visit('');
    expect(trackmargReturnUrl()).toBe(TRACKMARG_HUB_URL);
  });

  it('honours an explicit destination', () => {
    visit(`?return=${encodeURIComponent(`${HUB}/dashboard`)}`);
    expect(trackmargReturnUrl()).toBe(`${HUB}/dashboard`);
  });

  it('accepts a bare path and resolves it against the hub', () => {
    visit('?return=%2Fdashboard');
    expect(trackmargReturnUrl()).toBe(`${HUB}/dashboard`);
  });

  it('accepts a TrackMarg subdomain', () => {
    visit(`?return=${encodeURIComponent('https://app.trackmarg.in/home')}`);
    expect(trackmargReturnUrl()).toBe('https://app.trackmarg.in/home');
  });
});

describe('return URLs that must never be followed', () => {
  beforeEach(() => visit());

  const hostile: Array<[string, string]> = [
    ['a different site outright', 'https://evil.com'],
    ['protocol-relative, which URL() resolves to another host', '//evil.com'],
    ['a lookalike using the hub as a prefix of its own host', 'https://trackmarg.in.evil.com'],
    ['a lookalike without the dot - why endsWith alone is not enough', 'https://eviltrackmarg.in'],
    ['a javascript: URL', 'javascript:alert(document.cookie)'],
    ['a data: URL', 'data:text/html,<h1>hi</h1>'],
    ['plaintext http, when the hub is https', 'http://trackmarg.in/dashboard'],
    ['credentials smuggled before an @', 'https://trackmarg.in@evil.com/'],
    ['a backslash trick', 'https:\\\\evil.com'],
  ];

  for (const [why, candidate] of hostile) {
    it(`refuses ${why}`, () => {
      visit(`?return=${encodeURIComponent(candidate)}`);
      const target = trackmargReturnUrl();
      // Falls back to the real hub rather than following it. The property that matters is
      // that a tampered link can never send someone somewhere untrusted.
      expect(target).toBe(TRACKMARG_HUB_URL);
      expect(target).not.toContain('evil');
    });
  }
});
