import { describe, it, expect } from 'vitest';
import { matchesQuery, withinDateRange } from './search';
import type { Transaction } from './types';

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    sessionId: 's1',
    ownerId: 'u1',
    ownerName: 'Sahadev Pol',
    ownerInitials: 'SP',
    type: 'expense',
    category: 'Labour',
    amount: 1500,
    date: '2026-08-21',
    notes: 'Welding job for Pc200',
    createdById: 'u1',
    createdByName: 'Sahadev Pol',
    recordedOnBehalf: false,
    createdAt: '2026-08-21T10:00:00.000Z',
    updatedAt: '2026-08-21T10:00:00.000Z',
    deletedById: null,
    deletedByName: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('matchesQuery', () => {
  it('matches everything when the query is blank', () => {
    expect(matchesQuery(txn(), '')).toBe(true);
    expect(matchesQuery(txn(), '   ')).toBe(true);
  });

  it('searches notes, ignoring case', () => {
    expect(matchesQuery(txn(), 'welding')).toBe(true);
    expect(matchesQuery(txn(), 'WELDING')).toBe(true);
    expect(matchesQuery(txn(), 'pc200')).toBe(true);
    expect(matchesQuery(txn(), 'painting')).toBe(false);
  });

  it('searches the partner by name and by initials', () => {
    expect(matchesQuery(txn(), 'sahadev')).toBe(true);
    expect(matchesQuery(txn(), 'pol')).toBe(true);
    expect(matchesQuery(txn(), 'sp')).toBe(true);
    expect(matchesQuery(txn(), 'pandurang')).toBe(false);
  });

  it('searches the category, which is the row title', () => {
    expect(matchesQuery(txn(), 'labour')).toBe(true);
    expect(matchesQuery(txn({ category: 'Job Work' }), 'job')).toBe(true);
  });

  it('matches amounts however they are typed', () => {
    for (const query of ['1500', '1,500', '₹1500', '₹1,500', 'Rs 1500', 'rs.1500', '1500.00']) {
      expect(matchesQuery(txn(), query), query).toBe(true);
    }
  });

  it('narrows on a partial amount', () => {
    expect(matchesQuery(txn(), '150')).toBe(true);
    expect(matchesQuery(txn(), '15')).toBe(true);
    expect(matchesQuery(txn(), '1501')).toBe(false);
    expect(matchesQuery(txn(), '9999')).toBe(false);
  });

  it('matches paise amounts', () => {
    expect(matchesQuery(txn({ amount: 1500.5 }), '1500.5')).toBe(true);
    expect(matchesQuery(txn({ amount: 1500.5 }), '1500.50')).toBe(true);
    expect(matchesQuery(txn({ amount: 50 }), '50')).toBe(true);
  });

  it('does not treat a bare separator as an amount search', () => {
    // ".", "," and "₹" alone strip to nothing or a lone dot; neither should match every row
    // through the amount branch. "." still matches nothing textually here.
    expect(matchesQuery(txn({ notes: '', category: 'Labour' }), '.')).toBe(false);
  });

  it('falls back to text when a query mixes digits and letters', () => {
    // "Pc200" contains digits but is not an amount - it must still match on the notes.
    expect(matchesQuery(txn(), 'Pc200')).toBe(true);
    expect(matchesQuery(txn(), 'Pc999')).toBe(false);
  });
});

describe('withinDateRange', () => {
  const t = txn({ date: '2026-08-21' });

  it('accepts everything when both ends are blank', () => {
    expect(withinDateRange(t, '', '')).toBe(true);
  });

  it('is inclusive on both ends', () => {
    expect(withinDateRange(t, '2026-08-21', '2026-08-21')).toBe(true);
    expect(withinDateRange(t, '2026-08-01', '2026-08-31')).toBe(true);
  });

  it('excludes dates outside the range', () => {
    expect(withinDateRange(t, '2026-08-22', '')).toBe(false);
    expect(withinDateRange(t, '', '2026-08-20')).toBe(false);
  });

  it('works with only one end set', () => {
    expect(withinDateRange(t, '2026-01-01', '')).toBe(true);
    expect(withinDateRange(t, '', '2026-12-31')).toBe(true);
  });

  it('compares across year and month boundaries correctly', () => {
    const newYear = txn({ date: '2027-01-01' });
    expect(withinDateRange(newYear, '2026-12-31', '2027-01-02')).toBe(true);
    expect(withinDateRange(newYear, '2026-01-01', '2026-12-31')).toBe(false);
  });
});
