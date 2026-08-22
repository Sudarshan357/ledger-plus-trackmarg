import type { Transaction } from './types';

/// Matches a query against the things a person actually remembers about an entry: what it was
/// for, who recorded it, and roughly how much.
///
/// Amounts are matched on digits alone, so "1500", "1,500", "₹1500" and "Rs 1500" all find the
/// same row, and a partial "150" still narrows the list. Text matching is a plain
/// case-insensitive substring across category, notes, partner name and initials - a ledger has
/// tens of rows per session, not thousands, so anything cleverer would cost more in surprise
/// than it gained in precision.
export function matchesQuery(txn: Transaction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const text = [txn.category, txn.notes, txn.ownerName, txn.ownerInitials].join(' ').toLowerCase();
  if (text.includes(q)) return true;

  // Strip what people type around a number but that is not part of it.
  const digits = q.replace(/rs\.?/g, '').replace(/[₹,\s]/g, '');
  if (digits && /^[0-9]*\.?[0-9]*$/.test(digits) && digits !== '.') {
    if (String(txn.amount).includes(digits)) return true;
    if (txn.amount.toFixed(2).includes(digits)) return true;
  }
  return false;
}

/// Inclusive on both ends, and either end may be omitted. Dates are stored as YYYY-MM-DD, so
/// a string comparison is already a correct chronological one - going through Date here would
/// only reintroduce the timezone shift that storing them as plain strings avoids.
export function withinDateRange(txn: Transaction, from: string, to: string): boolean {
  if (from && txn.date < from) return false;
  if (to && txn.date > to) return false;
  return true;
}
