import crypto from 'node:crypto';

/// Trackmarg's normalization, matched exactly: uppercase, strip everything that is not a
/// letter or digit. This is what lets the UI show a friendly "TM-4821" while the database
/// stores "TM4821", and it means a partner can type the code with or without the hyphen, in
/// any case, and still land in the right group.
export function normalizeGroupCode(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/// Ledger+ group codes are "TM" + 4 digits, e.g. TM4821 (displayed TM-4821). The TM prefix is
/// the Trackmarg marker; the caller retries on collision against the unique index.
export function generateGroupCode(): string {
  // randomInt is the uniform, non-modulo-biased generator - a 4-digit code has a small enough
  // space (10k) that a biased one would collide noticeably faster.
  return `TM${String(crypto.randomInt(0, 10000)).padStart(4, '0')}`;
}

/// Renders a stored code for display: TM4821 -> TM-4821. Anything that does not match the
/// TM+digits shape is shown unchanged, so a partner who joined a pre-existing Trackmarg group
/// still sees their real code.
export function formatGroupCode(code: string): string {
  const match = /^([A-Z]{2})([0-9]{4,})$/.exec(code);
  return match ? `${match[1]}-${match[2]}` : code;
}

/// Short human-readable partner code shown next to a name where two partners might share one.
/// The "P-" prefix keeps it distinct from the transport app's "A-"/"D-" codes in the same
/// globally-unique column.
export function generateUserCode(): string {
  return `P-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

/// Initials for the avatar chips in the UI ("Sahadev Pol" -> "SP").
export function initialsOf(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
