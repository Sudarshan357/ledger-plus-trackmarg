import { Prisma } from '@prisma/client';

// Every calculation in Ledger+ runs on integer PAISE, never on floating-point rupees.
// 0.1 + 0.2 !== 0.3 in IEEE-754, and a partnership ledger that drifts by a paise per entry is
// worse than useless - the two partners' figures would stop reconciling. Rupees exist only at
// the JSON boundary (toRupees) and in the UI.

export type Paise = number;

export function toPaise(value: Prisma.Decimal | number | string): Paise {
  // Decimal.toFixed(2) is exact (arbitrary precision); Number() on the resulting short string
  // is lossless, unlike multiplying a float by 100.
  const fixed =
    value instanceof Prisma.Decimal ? value.toFixed(2) : Number(value || 0).toFixed(2);
  return Math.round(Number(fixed) * 100);
}

export function toRupees(paise: Paise): number {
  return Math.round(paise) / 100;
}

/// Half-away-from-zero, the rounding people expect for money (Math.round() biases negatives
/// toward zero: Math.round(-0.5) is -0, not -1).
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export interface TxnLike {
  ownerId: string;
  type: string;
  amount: Prisma.Decimal | number;
}

export interface PartnerRef {
  userId: string;
  name: string;
}

export interface PartnerTotals extends PartnerRef {
  received: Paise;
  expense: Paise;
  net: Paise;
  /// This partner's equal share of the profit minus what they are actually holding.
  /// Positive = money is coming TO them; negative = they must pay that much out.
  shareBalance: Paise;
}

export interface SettlementComputation {
  partners: PartnerTotals[];
  totalReceived: Paise;
  totalExpense: Paise;
  totalProfit: Paise;
  sharePerPartner: Paise;
  /// Who pays. Null when the session is already square (or there is only one partner).
  from: PartnerRef | null;
  to: PartnerRef | null;
  amount: Paise;
}

/// The whole financial model in one function.
///
/// Each partner's `net` is what they personally took in minus what they personally paid out -
/// in other words, how much of the partnership's money they are currently holding (a negative
/// net means they are out of pocket). The profit is the sum of those nets, and every partner
/// is entitled to an equal share of it, so:
///
///     shareBalance = (totalProfit / partnerCount) - net
///
/// A partner holding MORE than their share has a negative balance and must pay the
/// difference out; a partner holding less has a positive balance and receives it. Worth
/// stating plainly because it is easy to get backwards: the partner who collected the cash is
/// the one who owes money, not the one who is owed it. If Rahul receives Rs 500 and SP spends
/// Rs 1,500 of his own, the partnership is Rs 1,000 down, each partner carries Rs 500 of that
/// loss, and Rahul - despite being the only one who took money in - pays SP Rs 1,000.
///
/// For two partners the transfer reduces to |netA - netB| / 2. Computing it once, that way,
/// rather than rounding each share balance independently, is what guarantees the two figures
/// are exact mirrors and the payment leaves both partners square - splitting an odd number of
/// paise otherwise strands a paise that shows up forever as a 1p imbalance on the dashboard.
export function computeSettlement(
  partners: PartnerRef[],
  transactions: TxnLike[],
): SettlementComputation {
  const byPartner = new Map<string, { received: Paise; expense: Paise }>();
  for (const partner of partners) byPartner.set(partner.userId, { received: 0, expense: 0 });

  for (const txn of transactions) {
    // A transaction whose owner is no longer a member still counts toward the business
    // totals - dropping it would silently change the profit - so the bucket is created on
    // demand rather than skipped.
    let bucket = byPartner.get(txn.ownerId);
    if (!bucket) {
      bucket = { received: 0, expense: 0 };
      byPartner.set(txn.ownerId, bucket);
    }
    const amount = toPaise(txn.amount);
    if (txn.type === 'received') bucket.received += amount;
    else bucket.expense += amount;
  }

  const totals: PartnerTotals[] = partners.map((partner) => {
    const bucket = byPartner.get(partner.userId) ?? { received: 0, expense: 0 };
    return {
      ...partner,
      received: bucket.received,
      expense: bucket.expense,
      net: bucket.received - bucket.expense,
      shareBalance: 0,
    };
  });

  const totalReceived = totals.reduce((sum, p) => sum + p.received, 0);
  const totalExpense = totals.reduce((sum, p) => sum + p.expense, 0);
  const totalProfit = totalReceived - totalExpense;
  const count = totals.length || 1;
  const sharePerPartner = roundHalfAwayFromZero(totalProfit / count);

  if (totals.length === 2) {
    const [a, b] = totals;
    const amount = roundHalfAwayFromZero(Math.abs(a.net - b.net) / 2);
    // The higher net is the partner holding more than their share, so they are the payer.
    const aPays = a.net > b.net;
    a.shareBalance = aPays ? -amount : amount;
    b.shareBalance = -a.shareBalance;

    const payer = aPays ? a : b;
    const receiver = aPays ? b : a;

    return {
      partners: totals,
      totalReceived,
      totalExpense,
      totalProfit,
      sharePerPartner,
      from: amount === 0 ? null : { userId: payer.userId, name: payer.name },
      to: amount === 0 ? null : { userId: receiver.userId, name: receiver.name },
      amount,
    };
  }

  // One partner (a partnership waiting for its second member), or a hypothetical larger group.
  // Balances still tell each partner where they stand; a single pay-this-person instruction
  // only exists for the two-partner case Ledger+ is built around.
  for (const partner of totals) partner.shareBalance = sharePerPartner - partner.net;
  return {
    partners: totals,
    totalReceived,
    totalExpense,
    totalProfit,
    sharePerPartner,
    from: null,
    to: null,
    amount: 0,
  };
}
