-- Two-partner approval for settlement changes, plus payment and amendment state.
--
-- Additive only, and confined to the `ledger` schema like everything else Ledger+ owns.

-- ── Settlement: payment confirmation and amendment history ──────────────────
ALTER TABLE "ledger"."LedgerSettlement"
    ADD COLUMN "paidAt"         TIMESTAMP(3),
    ADD COLUMN "paidById"       TEXT,
    ADD COLUMN "amendedAt"      TIMESTAMP(3),
    ADD COLUMN "amendmentCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "originalAmount" DECIMAL(14,2);

-- Existing rows have never been amended, so their current amount IS their original. Without
-- this backfill an older settlement amended later would report "was NULL before".
UPDATE "ledger"."LedgerSettlement" SET "originalAmount" = "amount" WHERE "originalAmount" IS NULL;

-- ── Approvals ───────────────────────────────────────────────────────────────
CREATE TABLE "ledger"."LedgerApproval" (
    "id"            TEXT NOT NULL,
    "groupId"       TEXT NOT NULL,
    "kind"          TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT NOT NULL,
    "requestedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById"   TEXT,
    "decidedAt"     TIMESTAMP(3),
    "payload"       JSONB NOT NULL,
    "sessionId"     TEXT,
    "settlementId"  TEXT,

    CONSTRAINT "LedgerApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LedgerApproval_groupId_status_idx" ON "ledger"."LedgerApproval"("groupId", "status");

ALTER TABLE "ledger"."LedgerApproval"
    ADD CONSTRAINT "LedgerApproval_kind_valid"
    CHECK ("kind" IN ('close_session', 'amend_settlement'));
ALTER TABLE "ledger"."LedgerApproval"
    ADD CONSTRAINT "LedgerApproval_status_valid"
    CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled'));

-- At most ONE request awaiting a decision per partnership, enforced by the database rather
-- than only by the route. Two requests in flight at once would let a partner approve one
-- while the other silently rewrote the same session underneath it.
CREATE UNIQUE INDEX "LedgerApproval_one_pending_per_group"
    ON "ledger"."LedgerApproval"("groupId") WHERE "status" = 'pending';

ALTER TABLE "ledger"."LedgerApproval"
    ADD CONSTRAINT "LedgerApproval_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
