// The section 44 two-user acceptance flow, run end to end against the real database.
//
// It creates its own throwaway partnership (its own Trackmarg group code) and deletes it in
// afterAll, so it never touches any real group's data. Every figure asserted below is the one
// from the reference screenshots - if the settlement maths ever drifts, this is what catches it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from './app.js';
import { prisma } from './db/prisma.js';

process.env.NODE_ENV = 'test';

const app = buildApp();

// Unique per run so repeated runs never collide on the (groupId, phone) unique index.
const suffix = String(Date.now()).slice(-9);
const PHONE_A = `9${suffix}`;
const PHONE_B = `8${suffix}`;

let groupId = '';
let groupCode = '';
let tokenA = '';
let tokenB = '';
let userA = '';
let userB = '';

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

/// Closing a session takes two partners now: one asks, the other agrees. Wrapped up here
/// because several tests need a settled session as their starting point, not as their subject.
async function settleWithApproval(requester: string, approver: string) {
  const req = await request(app).post('/api/approvals/close-session').set(authed(requester));
  expect(req.status).toBe(202);
  const res = await request(app).post(`/api/approvals/${req.body.approvalId}/approve`).set(authed(approver));
  expect(res.status).toBe(200);
  return res;
}

afterAll(async () => {
  // Deleting the group cascades to users, members, sessions, transactions, settlements and
  // audit logs - both schemas, via the FKs declared in the migration.
  if (groupId) await prisma.group.delete({ where: { id: groupId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe('Ledger+ two-user partnership flow', () => {
  beforeAll(async () => {
    const res = await request(app).post('/api/auth/register').send({
      mode: 'create',
      name: 'Sahadev Pol',
      phone: PHONE_A,
      pin: '4821',
      confirmPin: '4821',
      businessName: 'S S Hydraulics & Fabrication',
    });
    expect(res.status).toBe(201);
    tokenA = res.body.token;
    userA = res.body.user.id;
    groupCode = res.body.group.code;
    groupId = res.body.group.id;
  });

  it('creates a Trackmarg group code in the TM-#### shape', async () => {
    expect(groupCode).toMatch(/^TM\d{4}$/);
    const res = await request(app).get('/api/account/me').set(authed(tokenA));
    expect(res.status).toBe(200);
    // Stored normalized, displayed with the hyphen.
    expect(res.body.group.displayCode).toBe(`${groupCode.slice(0, 2)}-${groupCode.slice(2)}`);
    expect(res.body.session.seq).toBe(1);
  });

  it('lets the second partner join with that code', async () => {
    const res = await request(app).post('/api/auth/register').send({
      mode: 'join',
      name: 'Pandurang Patil',
      phone: PHONE_B,
      pin: '778899',
      confirmPin: '778899',
      groupCode: `${groupCode.slice(0, 2)}-${groupCode.slice(2)}`, // typed WITH the hyphen
    });
    expect(res.status).toBe(201);
    tokenB = res.body.token;
    userB = res.body.user.id;
    expect(res.body.group.code).toBe(groupCode);
  });

  it('refuses a third partner', async () => {
    const res = await request(app).post('/api/auth/register').send({
      mode: 'join',
      name: 'Third Person',
      phone: `7${suffix}`,
      pin: '1234',
      confirmPin: '1234',
      groupCode,
    });
    expect(res.status).toBe(409);
  });

  it('rejects a PIN that is not 4-6 digits, and a mismatched confirmation', async () => {
    const short = await request(app).post('/api/auth/register').send({
      mode: 'create', name: 'Nope', phone: `6${suffix}`, pin: '123', confirmPin: '123',
    });
    expect(short.status).toBe(400);

    const mismatch = await request(app).post('/api/auth/register').send({
      mode: 'create', name: 'Nope', phone: `6${suffix}`, pin: '1234', confirmPin: '9999',
    });
    expect(mismatch.status).toBe(400);
  });

  it('shares one ledger: what A records, B sees', async () => {
    const created = await request(app).post('/api/transactions').set(authed(tokenA)).send({
      type: 'received', category: 'Sales', amount: 100000, date: '2026-08-21', notes: 'Advance Pc200',
    });
    expect(created.status).toBe(201);
    expect(created.body.transaction.ownerName).toBe('Sahadev Pol');

    const seenByB = await request(app).get('/api/transactions').set(authed(tokenB));
    expect(seenByB.status).toBe(200);
    expect(seenByB.body.transactions).toHaveLength(1);
    expect(seenByB.body.transactions[0].amount).toBe(100000);
  });

  it('shares one ledger in the other direction too', async () => {
    const created = await request(app).post('/api/transactions').set(authed(tokenB)).send({
      type: 'expense', category: 'Materials', amount: 50, date: '2026-08-21',
    });
    expect(created.status).toBe(201);

    const seenByA = await request(app).get('/api/transactions').set(authed(tokenA));
    expect(seenByA.body.transactions).toHaveLength(2);
  });

  it('defaults the owner to the signed-in partner', async () => {
    const res = await request(app).post('/api/transactions').set(authed(tokenA)).send({
      type: 'expense', category: 'Labour', amount: 2000, date: '2026-08-21',
    });
    expect(res.status).toBe(201);
    expect(res.body.transaction.ownerId).toBe(userA);
    expect(res.body.transaction.recordedOnBehalf).toBe(false);
  });

  it('lets a partner record on behalf of the other, and records who did', async () => {
    const expenseOf = async (userId: string) => {
      const overview = await request(app).get('/api/transactions/overview').set(authed(tokenB));
      return overview.body.partners.find((p: { userId: string }) => p.userId === userId).expense;
    };
    // Measured as a delta rather than an absolute: earlier steps have already put entries on
    // B's side, and a hard-coded total here would break every time one of them changes.
    const before = await expenseOf(userB);

    const res = await request(app).post('/api/transactions').set(authed(tokenA)).send({
      type: 'expense', category: 'Transport', amount: 300, date: '2026-08-21',
      ownerId: userB,
      // Forged creator - must be ignored. Who typed an entry is never taken from the body.
      createdById: userB,
    });
    expect(res.status).toBe(201);

    // Cleanup in a finally: this entry would otherwise skew every settlement figure asserted
    // later in the file, and an assertion failure below must not be able to leave it behind.
    try {
      expect(res.body.transaction.ownerId).toBe(userB);
      expect(res.body.transaction.ownerName).toBe('Pandurang Patil');
      expect(res.body.transaction.createdById).toBe(userA);
      expect(res.body.transaction.createdByName).toBe('Sahadev Pol');
      expect(res.body.transaction.recordedOnBehalf).toBe(true);

      // It counts on the owner's side of the books, not the recorder's.
      expect(await expenseOf(userB)).toBe(before + 300);

      // And the audit trail names the person who actually entered it.
      const audit = await prisma.ledgerAuditLog.findFirst({
        where: { groupId, action: 'transaction.created_on_behalf', entityId: res.body.transaction.id },
      });
      expect(audit).toBeTruthy();
      expect(audit!.userId).toBe(userA);
      expect((audit!.details as { recordedBy: string }).recordedBy).toBe('Sahadev Pol');

      // B owns it and may delete it even though A recorded it - that is the recourse that
      // stops one partner loading entries onto the other with no way to push back.
      const byOwner = await request(app)
        .delete(`/api/transactions/${res.body.transaction.id}`)
        .set(authed(tokenB));
      expect(byOwner.status).toBe(200);
    } finally {
      // Whether or not the delete above ran, make sure the row is gone for good.
      await request(app).delete(`/api/transactions/${res.body.transaction.id}`).set(authed(tokenA));
      const deleted = await request(app).get('/api/deleted').set(authed(tokenA));
      const rec = deleted.body.records?.find((r: { id: string }) => r.id === res.body.transaction.id);
      if (rec) {
        // Whoever deleted it, the other partner is the one who can destroy it.
        const destroyer = rec.deletedById === userA ? tokenB : tokenA;
        await request(app).delete(`/api/deleted/${rec.id}`).set(authed(destroyer));
      }
    }
    expect(await expenseOf(userB)).toBe(before);
  });

  it('refuses to file an entry for somebody outside the partnership', async () => {
    const outsider = await request(app).post('/api/auth/register').send({
      mode: 'create', name: 'Outsider', phone: `4${suffix}`, pin: '3333', confirmPin: '3333',
    });
    try {
      const res = await request(app).post('/api/transactions').set(authed(tokenA)).send({
        type: 'expense', category: 'Labour', amount: 10, date: '2026-08-21',
        ownerId: outsider.body.user.id,
      });
      expect(res.status).toBe(400);

      // A made-up id is refused too, rather than silently becoming the caller's own entry.
      const bogus = await request(app).post('/api/transactions').set(authed(tokenA)).send({
        type: 'expense', category: 'Labour', amount: 10, date: '2026-08-21', ownerId: 'not-a-user',
      });
      expect(bogus.status).toBe(400);
    } finally {
      await prisma.group.delete({ where: { id: outsider.body.group.id } }).catch(() => undefined);
    }
  });

  it("blocks changing an entry that is neither yours nor recorded by you", async () => {
    const list = await request(app).get('/api/transactions').set(authed(tokenA));
    const bsEntry = list.body.transactions.find(
      (t: { ownerId: string; createdById: string }) => t.ownerId === userB && t.createdById === userB,
    );
    expect(bsEntry).toBeTruthy();

    const edit = await request(app).patch(`/api/transactions/${bsEntry.id}`).set(authed(tokenA)).send({ amount: 1 });
    expect(edit.status).toBe(403);

    const del = await request(app).delete(`/api/transactions/${bsEntry.id}`).set(authed(tokenA));
    expect(del.status).toBe(403);
  });

  it('computes the settlement exactly as the reference does', async () => {
    // A: received 100000 + 10000 = 110000, expense 2000  -> net  108000
    // B: received 0,               expense 50            -> net     -50
    await request(app).post('/api/transactions').set(authed(tokenA)).send({
      type: 'received', category: 'Job Work', amount: 10000, date: '2026-08-21',
    });

    const res = await request(app).get('/api/transactions/overview').set(authed(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.totalReceived).toBe(110000);
    expect(res.body.totalExpense).toBe(2050);
    expect(res.body.totalProfit).toBe(107950);
    expect(res.body.sharePerPartner).toBe(53975);

    const [a, b] = res.body.partners;
    expect(a.name).toBe('Sahadev Pol');
    expect(a.received).toBe(110000);
    expect(a.expense).toBe(2000);
    expect(a.net).toBe(108000);
    // Sahadev is holding Rs 1,08,000 but is entitled to Rs 53,975, so he owes the surplus.
    // A negative share balance means "pay this out", not "you are owed this".
    expect(a.shareBalance).toBe(-54025);

    expect(b.name).toBe('Pandurang Patil');
    expect(b.received).toBe(0);
    expect(b.expense).toBe(50);
    expect(b.net).toBe(-50);
    expect(b.shareBalance).toBe(54025);

    // The partner who collected the cash pays the one who did not:
    // Sahadev Pol sends Pandurang Patil Rs 54,025.
    expect(res.body.from.name).toBe('Sahadev Pol');
    expect(res.body.to.name).toBe('Pandurang Patil');
    expect(res.body.amount).toBe(54025);
  });

  it('points the settlement at whoever is holding the surplus', async () => {
    // The direction is the easiest thing in this app to get backwards, so it gets its own
    // check on the simplest possible case: one partner takes money in, the other does
    // nothing, and the collector is the one who has to hand half of it over.
    const [a, b] = (await request(app).get('/api/transactions/overview').set(authed(tokenA))).body
      .partners;
    expect(a.net).toBeGreaterThan(b.net);
    const overview = (await request(app).get('/api/transactions/overview').set(authed(tokenA)))
      .body;
    expect(overview.from.userId).toBe(a.userId); // higher net pays
    expect(overview.to.userId).toBe(b.userId); // lower net receives
    // The two balances always mirror each other exactly, so a payment squares them both.
    expect(a.shareBalance + b.shareBalance).toBe(0);
  });

  it('reports the same figures per partner and per category for the month', async () => {
    const res = await request(app)
      .get('/api/reports?mode=monthly&period=2026-08')
      .set(authed(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(110000);
    expect(res.body.expense).toBe(2050);
    expect(res.body.profit).toBe(107950);

    const labour = res.body.byCategory.find((c: { category: string }) => c.category === 'Labour');
    const materials = res.body.byCategory.find((c: { category: string }) => c.category === 'Materials');
    expect(labour.amount).toBe(2000);
    expect(materials.amount).toBe(50);

    // A month with nothing in it reports zeroes rather than failing.
    const empty = await request(app).get('/api/reports?mode=monthly&period=2026-01').set(authed(tokenA));
    expect(empty.body.profit).toBe(0);
  });

  describe('the two-person delete safety rule', () => {
    let deletedId = '';

    it('moves A\'s own deletion into Deleted Records rather than destroying it', async () => {
      const list = await request(app).get('/api/transactions').set(authed(tokenA));
      const own = list.body.transactions.find(
        (t: { ownerId: string; category: string }) => t.ownerId === userA && t.category === 'Job Work',
      );
      deletedId = own.id;

      const res = await request(app).delete(`/api/transactions/${deletedId}`).set(authed(tokenA));
      expect(res.status).toBe(200);

      // Gone from the ledger...
      const after = await request(app).get('/api/transactions').set(authed(tokenA));
      expect(after.body.transactions.find((t: { id: string }) => t.id === deletedId)).toBeUndefined();

      // ...but present, whole, in Deleted Records, with every original field intact.
      const deleted = await request(app).get('/api/deleted').set(authed(tokenA));
      const record = deleted.body.records.find((r: { id: string }) => r.id === deletedId);
      expect(record).toBeTruthy();
      expect(record.amount).toBe(10000);
      expect(record.category).toBe('Job Work');
      expect(record.ownerName).toBe('Sahadev Pol');
      expect(record.deletedByName).toBe('Sahadev Pol');
      expect(record.deletedAt).toBeTruthy();
      expect(record.sessionLabel).toBe('Session #001');
    });

    it('will not let A permanently delete what A deleted', async () => {
      const view = await request(app).get('/api/deleted').set(authed(tokenA));
      const record = view.body.records.find((r: { id: string }) => r.id === deletedId);
      expect(record.canPermanentlyDelete).toBe(false);

      const res = await request(app).delete(`/api/deleted/${deletedId}`).set(authed(tokenA));
      expect(res.status).toBe(403);

      // Still there.
      const after = await request(app).get('/api/deleted').set(authed(tokenA));
      expect(after.body.records.find((r: { id: string }) => r.id === deletedId)).toBeTruthy();
    });

    it('lets B permanently delete it, leaving an audit trail', async () => {
      const view = await request(app).get('/api/deleted').set(authed(tokenB));
      const record = view.body.records.find((r: { id: string }) => r.id === deletedId);
      expect(record.canPermanentlyDelete).toBe(true);

      const res = await request(app).delete(`/api/deleted/${deletedId}`).set(authed(tokenB));
      expect(res.status).toBe(200);

      const after = await request(app).get('/api/deleted').set(authed(tokenB));
      expect(after.body.records.find((r: { id: string }) => r.id === deletedId)).toBeUndefined();

      const audit = await prisma.ledgerAuditLog.findFirst({
        where: { groupId, action: 'transaction.permanently_deleted', entityId: deletedId },
      });
      expect(audit).toBeTruthy();
      expect((audit!.details as { permanentlyDeletedByName: string }).permanentlyDeletedByName).toBe(
        'Pandurang Patil',
      );
    });
  });

  describe('start fresh session', () => {
    let closedSettlementId = '';

    it('freezes the settlement, archives the session and reopens at zero', async () => {
      const before = await request(app).get('/api/settlement/preview').set(authed(tokenB));
      // Job Work (10,000) is gone now, so: A net 98,000, B net -50 -> profit 97,950.
      expect(before.body.totalProfit).toBe(97950);
      expect(before.body.amount).toBe(49025);

      // Closing now needs the other partner to agree, so the direct endpoint refuses.
      expect((await request(app).post('/api/settlement/close').set(authed(tokenB))).status).toBe(409);

      const res = await settleWithApproval(tokenB, tokenA);
      closedSettlementId = res.body.settlement.id;
      expect(res.body.settlement.label).toBe('Settlement #001');
      expect(res.body.settlement.totalProfit).toBe(97950);
      expect(res.body.settlement.amount).toBe(49025);
      expect(res.body.settlement.fromUserName).toBe('Sahadev Pol');
      expect(res.body.settlement.toUserName).toBe('Pandurang Patil');
      // A brand new, empty session.
      expect(res.body.session.seq).toBe(2);
    });

    it('starts the new session from zero for both partners', async () => {
      for (const token of [tokenA, tokenB]) {
        const res = await request(app).get('/api/transactions/overview').set(authed(token));
        expect(res.body.session.seq).toBe(2);
        expect(res.body.totalReceived).toBe(0);
        expect(res.body.totalExpense).toBe(0);
        expect(res.body.totalProfit).toBe(0);
        expect(res.body.amount).toBe(0);
        expect(res.body.transactionCount).toBe(0);
      }
    });

    it('keeps the old session readable in Settlement Details', async () => {
      const history = await request(app).get('/api/settlement/history').set(authed(tokenA));
      expect(history.body.settlements).toHaveLength(1);

      const detail = await request(app)
        .get(`/api/settlement/history/${closedSettlementId}`)
        .set(authed(tokenA));
      expect(detail.status).toBe(200);
      // The frozen snapshot still carries every transaction from the closed period.
      const summary = detail.body.settlement.summary;
      expect(summary.transactionCount).toBe(3);
      expect(summary.partners).toHaveLength(2);
      expect(summary.transactions.some((t: { category: string }) => t.category === 'Sales')).toBe(true);
    });

    it('files new entries against the new session only', async () => {
      const created = await request(app).post('/api/transactions').set(authed(tokenA)).send({
        type: 'received', category: 'Sales', amount: 500, date: '2026-08-22',
      });
      expect(created.status).toBe(201);

      const current = await request(app).get('/api/transactions').set(authed(tokenA));
      expect(current.body.session.seq).toBe(2);
      expect(current.body.transactions).toHaveLength(1);
      expect(current.body.transactions[0].amount).toBe(500);

      // The closed session's transactions are untouched and still reachable across all sessions.
      const all = await request(app).get('/api/transactions?scope=all').set(authed(tokenA));
      expect(all.body.transactions).toHaveLength(4);
    });

    it('refuses to settle a session with nothing in it', async () => {
      // Session 2 has one entry, so this one closes; session 3 is then empty.
      await settleWithApproval(tokenA, tokenB);
      const empty = await request(app).post('/api/approvals/close-session').set(authed(tokenA));
      expect(empty.status).toBe(400);
    });
  });

  describe('two-partner approval', () => {
    let approvalId = '';

    beforeAll(async () => {
      await request(app).post('/api/transactions').set(authed(tokenA)).send({
        type: 'received', category: 'Sales', amount: 8000, date: '2026-08-22',
      });
      const res = await request(app).post('/api/approvals/close-session').set(authed(tokenA));
      expect(res.status).toBe(202);
      expect(res.body.applied).toBe(false);
      approvalId = res.body.approvalId;
    });

    it('changes nothing until the other partner agrees', async () => {
      const history = await request(app).get('/api/settlement/history').set(authed(tokenA));
      const before = history.body.settlements.length;
      const current = await request(app).get('/api/bootstrap').set(authed(tokenA));
      // The live session is untouched while the request is outstanding.
      expect(current.body.overview.totalReceived).toBe(8000);
      expect((await request(app).get('/api/settlement/history').set(authed(tokenA))).body.settlements)
        .toHaveLength(before);
    });

    it('shows the request to both partners, correctly attributed', async () => {
      const forA = await request(app).get('/api/bootstrap').set(authed(tokenA));
      const forB = await request(app).get('/api/bootstrap').set(authed(tokenB));
      expect(forA.body.pendingApproval.isMine).toBe(true);
      expect(forB.body.pendingApproval.isMine).toBe(false);
      expect(forB.body.pendingApproval.requestedByName).toBe('Sahadev Pol');
      expect(forB.body.pendingApproval.kind).toBe('close_session');
    });

    it('will not let the requester wave through their own request', async () => {
      expect((await request(app).post(`/api/approvals/${approvalId}/approve`).set(authed(tokenA))).status).toBe(403);
      // Nor stack a second request on top of the first.
      expect((await request(app).post('/api/approvals/close-session').set(authed(tokenB))).status).toBe(409);
    });

    it('applies it once approved, and only once', async () => {
      const res = await request(app).post(`/api/approvals/${approvalId}/approve`).set(authed(tokenB));
      expect(res.status).toBe(200);
      expect(res.body.kind).toBe('close_session');

      const again = await request(app).post(`/api/approvals/${approvalId}/approve`).set(authed(tokenB));
      expect(again.status).toBe(409);

      const after = await request(app).get('/api/bootstrap').set(authed(tokenA));
      expect(after.body.pendingApproval).toBeNull();
      expect(after.body.overview.totalReceived).toBe(0);
    });

    it('lets a request be rejected, and the live session survives', async () => {
      await request(app).post('/api/transactions').set(authed(tokenB)).send({
        type: 'expense', category: 'Labour', amount: 700, date: '2026-08-22',
      });
      const req = await request(app).post('/api/approvals/close-session').set(authed(tokenB));
      expect(req.status).toBe(202);

      // The requester cannot reject their own; they withdraw it instead.
      expect((await request(app).post(`/api/approvals/${req.body.approvalId}/reject`).set(authed(tokenB))).status).toBe(403);
      expect((await request(app).post(`/api/approvals/${req.body.approvalId}/reject`).set(authed(tokenA))).status).toBe(200);

      const after = await request(app).get('/api/bootstrap').set(authed(tokenA));
      expect(after.body.pendingApproval).toBeNull();
      expect(after.body.overview.totalExpense).toBe(700);
    });

    it('lets the requester withdraw their own request', async () => {
      const req = await request(app).post('/api/approvals/close-session').set(authed(tokenA));
      expect((await request(app).post(`/api/approvals/${req.body.approvalId}/cancel`).set(authed(tokenB))).status).toBe(403);
      expect((await request(app).post(`/api/approvals/${req.body.approvalId}/cancel`).set(authed(tokenA))).status).toBe(200);
      expect((await request(app).get('/api/bootstrap').set(authed(tokenA))).body.pendingApproval).toBeNull();
    });
  });

  describe('settlement payment and amendment', () => {
    let settlementId = '';

    beforeAll(async () => {
      const res = await settleWithApproval(tokenA, tokenB);
      settlementId = res.body.settlement.id;
    });

    it('needs the other partner to confirm that the money moved', async () => {
      const before = await request(app).get(`/api/settlement/history/${settlementId}`).set(authed(tokenA));
      expect(before.body.settlement.paid).toBe(false);

      // One partner cannot simply declare it paid.
      expect((await request(app).post(`/api/settlement/history/${settlementId}/paid`).set(authed(tokenA))).status).toBe(409);

      const req = await request(app).post('/api/approvals/mark-paid').set(authed(tokenA))
        .send({ settlementId });
      expect(req.status).toBe(202);

      // Still unpaid while the request is outstanding, and the other partner is told.
      expect((await request(app).get(`/api/settlement/history/${settlementId}`).set(authed(tokenA)))
        .body.settlement.paid).toBe(false);
      const forB = await request(app).get('/api/bootstrap').set(authed(tokenB));
      expect(forB.body.pendingApproval.kind).toBe('mark_paid');
      expect(forB.body.pendingApproval.isMine).toBe(false);
      expect(forB.body.pendingApproval.settlementId).toBe(settlementId);

      expect((await request(app).post(`/api/approvals/${req.body.approvalId}/approve`).set(authed(tokenA))).status).toBe(403);
      expect((await request(app).post(`/api/approvals/${req.body.approvalId}/approve`).set(authed(tokenB))).status).toBe(200);

      const seen = await request(app).get(`/api/settlement/history/${settlementId}`).set(authed(tokenB));
      expect(seen.body.settlement.paid).toBe(true);
      // Credited to whoever claimed the payment, not whoever agreed to it.
      expect(seen.body.settlement.paidById).toBe(userA);
      expect(seen.body.settlement.paidAt).toBeTruthy();

      // Un-marking returns it to "not yet paid", the conservative direction, so it needs no
      // permission from anyone.
      expect((await request(app).delete(`/api/settlement/history/${settlementId}/paid`).set(authed(tokenB))).status).toBe(200);
      expect((await request(app).get(`/api/settlement/history/${settlementId}`).set(authed(tokenA))).body.settlement.paid).toBe(false);
    });

    it('leaves a settlement unpaid when the partner rejects the claim', async () => {
      const req = await request(app).post('/api/approvals/mark-paid').set(authed(tokenB))
        .send({ settlementId });
      expect(req.status).toBe(202);
      expect((await request(app).post(`/api/approvals/${req.body.approvalId}/reject`).set(authed(tokenA))).status).toBe(200);
      expect((await request(app).get(`/api/settlement/history/${settlementId}`).set(authed(tokenA)))
        .body.settlement.paid).toBe(false);
      expect((await request(app).get('/api/bootstrap').set(authed(tokenA))).body.pendingApproval).toBeNull();
    });

    it('recomputes an amended settlement instead of letting it drift', async () => {
      const before = (await request(app).get(`/api/settlement/history/${settlementId}`).set(authed(tokenA)))
        .body.settlement;

      const req = await request(app).post('/api/approvals/amend-settlement').set(authed(tokenA)).send({
        settlementId, type: 'expense', category: 'Transport', amount: 500,
        date: '2026-08-22', notes: 'forgotten diesel', ownerId: userA,
      });
      expect(req.status).toBe(202);

      // Nothing moves until the other partner agrees.
      const during = (await request(app).get(`/api/settlement/history/${settlementId}`).set(authed(tokenA)))
        .body.settlement;
      expect(during.totalProfit).toBe(before.totalProfit);

      expect((await request(app).post(`/api/approvals/${req.body.approvalId}/approve`).set(authed(tokenB))).status).toBe(200);

      const after = (await request(app).get(`/api/settlement/history/${settlementId}`).set(authed(tokenA)))
        .body.settlement;
      expect(after.totalProfit).toBe(before.totalProfit - 500);
      expect(after.totalExpense).toBe(before.totalExpense + 500);
      expect(after.amended).toBe(true);
      expect(after.amendmentCount).toBe(1);
      // What it said when both partners first agreed to it is preserved.
      expect(after.originalAmount).toBe(before.amount);
      // The stored snapshot is rebuilt, not left stale.
      expect(after.summary.transactionCount).toBe(before.summary.transactionCount + 1);
      expect(after.summary.transactions.some((t: { notes: string }) => t.notes === 'forgotten diesel')).toBe(true);
    });

    it('refuses an amendment for a settlement in another partnership', async () => {
      const other = await request(app).post('/api/auth/register').send({
        mode: 'create', name: 'Elsewhere', phone: `3${suffix}`, pin: '4444', confirmPin: '4444',
      });
      try {
        const res = await request(app).post('/api/approvals/amend-settlement').set(authed(other.body.token)).send({
          settlementId, type: 'expense', category: 'Labour', amount: 10, date: '2026-08-22',
        });
        expect(res.status).toBe(404);
      } finally {
        await prisma.group.delete({ where: { id: other.body.group.id } }).catch(() => undefined);
      }
    });
  });

  describe('group isolation and account security', () => {
    it('never returns another partnership\'s data', async () => {
      const other = await request(app).post('/api/auth/register').send({
        mode: 'create', name: 'Outsider', phone: `5${suffix}`, pin: '1111', confirmPin: '1111',
        businessName: 'Other Firm',
      });
      expect(other.status).toBe(201);
      const outsiderToken = other.body.token;

      try {
        const theirLedger = await request(app).get('/api/transactions?scope=all').set(authed(outsiderToken));
        expect(theirLedger.body.transactions).toHaveLength(0);

        const theirHistory = await request(app).get('/api/settlement/history').set(authed(outsiderToken));
        expect(theirHistory.body.settlements).toHaveLength(0);

        const theirDeleted = await request(app).get('/api/deleted').set(authed(outsiderToken));
        expect(theirDeleted.body.records).toHaveLength(0);

        // A direct id from our group must not resolve for them.
        const list = await request(app).get('/api/transactions').set(authed(tokenA));
        const anyId = list.body.transactions[0]?.id;
        if (anyId) {
          const poke = await request(app).patch(`/api/transactions/${anyId}`).set(authed(outsiderToken)).send({ amount: 1 });
          expect(poke.status).toBe(404);
        }
      } finally {
        await prisma.group.delete({ where: { id: other.body.group.id } }).catch(() => undefined);
      }
    });

    it('rejects requests with no token, a junk token, or a revoked one', async () => {
      expect((await request(app).get('/api/transactions')).status).toBe(401);
      expect((await request(app).get('/api/transactions').set(authed('nonsense'))).status).toBe(401);

      const login = await request(app).post('/api/auth/login').send({
        groupCode, phone: PHONE_B, pin: '778899',
      });
      expect(login.status).toBe(200);
      const throwaway = login.body.token;

      expect((await request(app).get('/api/account/me').set(authed(throwaway))).status).toBe(200);
      await request(app).post('/api/account/logout').set(authed(throwaway));
      expect((await request(app).get('/api/account/me').set(authed(throwaway))).status).toBe(401);
    });

    it('verifies the PIN server-side for unlock, and enforces the rules on change', async () => {
      expect((await request(app).post('/api/account/unlock').set(authed(tokenA)).send({ pin: '0000' })).status).toBe(401);
      expect((await request(app).post('/api/account/unlock').set(authed(tokenA)).send({ pin: '4821' })).status).toBe(200);

      const wrongCurrent = await request(app).post('/api/account/change-pin').set(authed(tokenA))
        .send({ currentPin: '0000', newPin: '5555', confirmPin: '5555' });
      expect(wrongCurrent.status).toBe(401);

      const badShape = await request(app).post('/api/account/change-pin').set(authed(tokenA))
        .send({ currentPin: '4821', newPin: '55', confirmPin: '55' });
      expect(badShape.status).toBe(400);

      const changed = await request(app).post('/api/account/change-pin').set(authed(tokenA))
        .send({ currentPin: '4821', newPin: '551234', confirmPin: '551234' });
      expect(changed.status).toBe(200);

      // The new PIN works and the old one does not.
      expect((await request(app).post('/api/account/unlock').set(authed(tokenA)).send({ pin: '551234' })).status).toBe(200);
      expect((await request(app).post('/api/account/unlock').set(authed(tokenA)).send({ pin: '4821' })).status).toBe(401);
    });

    it('rejects a login for a group the user does not belong to', async () => {
      const res = await request(app).post('/api/auth/login').send({
        groupCode: 'TM0000', phone: PHONE_A, pin: '551234',
      });
      expect([401, 404]).toContain(res.status);
    });
  });

  it('rejects malformed amounts, dates and categories', async () => {
    const cases = [
      { type: 'received', category: 'Sales', amount: 0, date: '2026-08-22' },
      { type: 'received', category: 'Sales', amount: -5, date: '2026-08-22' },
      { type: 'received', category: 'Sales', amount: 'abc', date: '2026-08-22' },
      { type: 'received', category: 'Sales', amount: 10, date: '21-08-2026' },
      // 'Labour' is an expense category; it must not be accepted for a received entry.
      { type: 'received', category: 'Labour', amount: 10, date: '2026-08-22' },
      { type: 'transfer', category: 'Sales', amount: 10, date: '2026-08-22' },
    ];
    for (const body of cases) {
      const res = await request(app).post('/api/transactions').set(authed(tokenA)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});
