import { Router } from 'express';
import * as transactionsRepo from '../db/repositories/transactions.repository.js';
import { CHART_CATEGORY_ORDER } from '../services/categories.js';
import { computeSettlement, toPaise, toRupees } from '../services/money.js';
import { serializePartnerTotals } from '../services/serializers.js';
import { loadPartners } from '../services/ledgerQueries.js';
import { HttpError } from '../middleware/errorHandler.js';
import { auth } from '../middleware/auth.js';

export const reportsRouter = Router();

// Reports are CALENDAR-scoped, not session-scoped: "August 2026" means everything that
// happened in August 2026, whichever accounting session it happened to fall in. The Home
// dashboard and settlement are session-scoped instead - those answer "where do we stand right
// now", which is a different question from "what did this month look like".

function monthRange(period: string): { start: Date; end: Date; label: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new HttpError(400, 'Expected a period of the form YYYY-MM');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new HttpError(400, 'Expected a period of the form YYYY-MM');
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    // Exclusive upper bound. Day 0 of the next month would be the last day of this one, which
    // would silently drop every transaction dated on it.
    end: new Date(Date.UTC(year, month, 1)),
    label: new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  };
}

function yearRange(period: string): { start: Date; end: Date; label: string } {
  const match = /^(\d{4})$/.exec(period);
  if (!match) throw new HttpError(400, 'Expected a period of the form YYYY');
  const year = Number(match[1]);
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
    label: String(year),
  };
}

reportsRouter.get('/', async (req, res, next) => {
  try {
    const { groupId } = auth(req);
    const mode = req.query.mode === 'yearly' ? 'yearly' : 'monthly';
    const period = String(req.query.period || '');
    const { start, end, label } = mode === 'yearly' ? yearRange(period) : monthRange(period);

    const { partners } = await loadPartners(groupId);
    const all = await transactionsRepo.listLiveByGroup(groupId);
    const inPeriod = all.filter((row) => row.date >= start && row.date < end);

    const computation = computeSettlement(partners, inPeriod);

    // Expense categories only - the chart is titled "Expenses by category". Every known
    // category is emitted even at zero so the axis stays stable as a month fills up.
    const byCategoryPaise = new Map<string, number>(CHART_CATEGORY_ORDER.map((c) => [c, 0]));
    for (const row of inPeriod) {
      if (row.type !== 'expense') continue;
      byCategoryPaise.set(row.category, (byCategoryPaise.get(row.category) ?? 0) + toPaise(row.amount));
    }

    res.json({
      mode,
      period,
      label,
      received: toRupees(computation.totalReceived),
      expense: toRupees(computation.totalExpense),
      profit: toRupees(computation.totalProfit),
      transactionCount: inPeriod.length,
      byCategory: [...byCategoryPaise.entries()].map(([category, paise]) => ({
        category,
        amount: toRupees(paise),
      })),
      perPartner: computation.partners.map(serializePartnerTotals),
    });
  } catch (err) {
    next(err);
  }
});
