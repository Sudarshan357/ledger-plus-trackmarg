import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The return URL is the whole security surface of the "Back to TrackMarg" button, and an open
 * redirect on a SIGN-IN screen is the most valuable kind there is: the victim follows a link
 * on the real ledger.trackmarg.in, sees the real sign-in page, taps a button reading "Back to
 * TrackMarg" and lands on an attacker's copy - having just been taught that this exact flow is
 * normal. Nobody would catch that by clicking around, so it is tested directly.
 */

const HUB = 'https://trackmarg.in';

/// Node has no DOM. The module reads exactly these three things.
function visit({ search = '', referrer = '', host = 'ledger.trackmarg.in' } = {}) {
  vi.stubGlobal('window', { location: { search, hostname: host } });
  vi.stubGlobal('document', { referrer });
}

const { trackmargReturnUrl, TRACKMARG_HUB_URL } = await import('./trackmarg');

describe('arriving from TrackMarg', () => {
  beforeEach(() => visit());

  it('shows nothing for someone who opened the app directly', () => {
    expect(trackmargReturnUrl()).toBeNull();
  });

  it('falls back to the hub when told it came from TrackMarg but not from where', () => {
    visit({ search: '?from=trackmarg' });
    expect(trackmargReturnUrl()).toBe(TRACKMARG_HUB_URL);
  });

  it('honours an explicit destination', () => {
    visit({ search: `?return=${encodeURIComponent(`${HUB}/dashboard`)}` });
    expect(trackmargReturnUrl()).toBe(`${HUB}/dashboard`);
  });

  it('accepts a bare path and resolves it against the hub', () => {
    visit({ search: '?return=%2Fdashboard' });
    expect(trackmargReturnUrl()).toBe(`${HUB}/dashboard`);
  });

  it('accepts a TrackMarg subdomain', () => {
    visit({ search: `?return=${encodeURIComponent('https://app.trackmarg.in/home')}` });
    expect(trackmargReturnUrl()).toBe('https://app.trackmarg.in/home');
  });

  it('follows an ordinary link, with nothing added at the other end', () => {
    visit({ referrer: 'https://trackmarg.in/some/page' });
    expect(trackmargReturnUrl()).toBe(TRACKMARG_HUB_URL);
  });

  it('does not treat its own pages as an arrival from TrackMarg', () => {
    // Ledger+ is itself a subdomain, so without the self-check every internal navigation
    // would qualify and the button would show up for everyone.
    visit({ referrer: 'https://ledger.trackmarg.in/settings', host: 'ledger.trackmarg.in' });
    expect(trackmargReturnUrl()).toBeNull();
  });

  it('ignores a referrer from anywhere else', () => {
    visit({ referrer: 'https://evil.com/bait' });
    expect(trackmargReturnUrl()).toBeNull();
  });
});

describe('return URLs that must be refused', () => {
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
      visit({ search: `?return=${encodeURIComponent(candidate)}` });
      expect(trackmargReturnUrl()).toBeNull();
    });
  }

  it('shows no button at all rather than quietly falling back to the hub', () => {
    // A tampered link should not still produce a working button - that would lend the
    // tampering an air of legitimacy and hide that anything was wrong.
    visit({ search: `?return=${encodeURIComponent('https://evil.com')}&from=trackmarg` });
    expect(trackmargReturnUrl()).toBeNull();
  });
});
