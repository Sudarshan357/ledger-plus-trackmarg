// Indian number formatting throughout: the lakh/crore grouping (1,07,950 - not 107,950) is
// what the people using this app read fluently, and getting it wrong makes every figure on
// the screen feel foreign.

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/// Full precision: "₹1,07,950". Paise are shown only when there are any, so whole-rupee
/// amounts (nearly all of them) stay uncluttered.
export function formatRupees(amount: number): string {
  const hasPaise = Math.round(Math.abs(amount) * 100) % 100 !== 0;
  const abs = Math.abs(amount);
  const body = hasPaise ? inr.format(abs) : inrWhole.format(abs);
  return `${amount < 0 ? '-' : ''}₹${body}`;
}

/// Signed, for ledger rows: "+₹1,00,000" / "-₹2,000".
export function formatSigned(amount: number, type: 'received' | 'expense'): string {
  return `${type === 'received' ? '+' : '-'}${formatRupees(Math.abs(amount))}`;
}

/// Compact, for the tiles where space is tight: "₹1.10L", "₹2.0K", "₹54.0K".
/// Crore and lakh keep two decimals, thousands keep one - matching the reference exactly.
export function formatCompact(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${inrWhole.format(abs)}`;
}

/// Signed compact, for share balances: "+₹54,025" reads better in full than compacted, so
/// this keeps full precision but always shows the sign.
export function formatSignedFull(amount: number): string {
  if (amount === 0) return formatRupees(0);
  return `${amount > 0 ? '+' : '-'}${formatRupees(Math.abs(amount))}`;
}

// ── Dates ─────────────────────────────────────────────────────────────────

/// "21 Aug 2026". Takes a plain YYYY-MM-DD and never routes it through the Date parser's
/// timezone handling, which would shift the day west of UTC.
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

/// "21 Aug 2026, 11:57 pm" - for audit-style stamps (deleted at, closed at) which are real
/// instants and so are shown in the reader's own timezone.
export function formatDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDateShort(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/// Today as YYYY-MM-DD in the device's own timezone - the default for a new entry, since a
/// partner recording an expense at 11pm means today, not tomorrow in UTC.
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[(m || 1) - 1]} ${y}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1 + delta, 1);
  return monthKey(date);
}
