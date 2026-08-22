import crypto from 'node:crypto';

// PBKDF2, 100k iterations, `salt:hash` hex encoding. This is byte-for-byte the same scheme
// the Trackmarg transport app uses, and that compatibility is required, not incidental: both
// apps write `public."User".passwordHash` on the same database, so a hash written by one must
// verify in the other.
export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(pin), salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string | undefined): boolean {
  try {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    const computed = crypto.pbkdf2Sync(String(pin), salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

/// Numeric, 4-6 digits. Enforced here so registration, PIN change and unlock cannot drift
/// apart, and so the rule lives on the server rather than only in the input's maxlength.
export function isValidPin(pin: unknown): boolean {
  return /^[0-9]{4,6}$/.test(String(pin ?? ''));
}
