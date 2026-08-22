// Categories are type-aware: what you spend money ON and what you receive money FOR are
// different vocabularies, and forcing one list on both would put "Labour" in the income
// picker and leave no way to label a sale.
//
// Kept in sync with src/lib/categories.ts on the frontend. The frontend list drives the
// chips; this one is the authority - a request carrying anything else is rejected.

export const EXPENSE_CATEGORIES = ['Materials', 'Labour', 'Machinery', 'Transport', 'Other'] as const;
export const RECEIVED_CATEGORIES = ['Sales', 'Job Work', 'Advance', 'Other'] as const;

export type TransactionType = 'received' | 'expense';

export function categoriesFor(type: TransactionType): readonly string[] {
  return type === 'expense' ? EXPENSE_CATEGORIES : RECEIVED_CATEGORIES;
}

export function isValidCategory(type: TransactionType, category: unknown): boolean {
  return categoriesFor(type).includes(String(category ?? ''));
}

/// Order used by the "Expenses by category" chart, so the bars do not jump around between
/// renders as amounts change.
export const CHART_CATEGORY_ORDER = EXPENSE_CATEGORIES;
