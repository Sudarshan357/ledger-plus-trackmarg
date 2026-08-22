// Mirrors backend/src/services/categories.ts. The server is the authority - it rejects
// anything not on its list - but the chips have to come from somewhere, and a round trip to
// fetch five strings that change once a year would be worse than keeping them in step here.

export const EXPENSE_CATEGORIES = ['Materials', 'Labour', 'Machinery', 'Transport', 'Other'];
export const RECEIVED_CATEGORIES = ['Sales', 'Job Work', 'Advance', 'Other'];

export function categoriesFor(type: 'received' | 'expense'): string[] {
  return type === 'expense' ? EXPENSE_CATEGORIES : RECEIVED_CATEGORIES;
}
