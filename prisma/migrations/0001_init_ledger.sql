-- Ledger+ initial schema.
--
-- Everything here lives in a dedicated `ledger` Postgres schema. Nothing in `public` is
-- created, altered or dropped: the Trackmarg transport app owns those tables, its Prisma
-- datasource only looks at `public`, and so it will never see these tables as drift.
--
-- Applied through DIRECT_URL (port 5432) by backend/src/scripts/applyMigrations.ts. Ledger+
-- keeps its own migration ledger in ledger._migrations rather than writing to the shared
-- public._prisma_migrations table, which belongs to the transport app's history.

CREATE SCHEMA IF NOT EXISTS "ledger";

-- ── LedgerMember ────────────────────────────────────────────────────────────
CREATE TABLE "ledger"."LedgerMember" (
    "id"       TEXT NOT NULL,
    "groupId"  TEXT NOT NULL,
    "userId"   TEXT NOT NULL,
    "role"     TEXT NOT NULL DEFAULT 'partner',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LedgerMember_userId_key" ON "ledger"."LedgerMember"("userId");
CREATE UNIQUE INDEX "LedgerMember_groupId_userId_key" ON "ledger"."LedgerMember"("groupId", "userId");
CREATE INDEX "LedgerMember_groupId_idx" ON "ledger"."LedgerMember"("groupId");

ALTER TABLE "ledger"."LedgerMember"
    ADD CONSTRAINT "LedgerMember_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger"."LedgerMember"
    ADD CONSTRAINT "LedgerMember_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── LedgerSession (an accounting period, not an auth session) ───────────────
CREATE TABLE "ledger"."LedgerSession" (
    "id"         TEXT NOT NULL,
    "groupId"    TEXT NOT NULL,
    "seq"        INTEGER NOT NULL,
    "status"     TEXT NOT NULL DEFAULT 'active',
    "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"   TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "LedgerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LedgerSession_groupId_seq_key" ON "ledger"."LedgerSession"("groupId", "seq");
CREATE INDEX "LedgerSession_groupId_status_idx" ON "ledger"."LedgerSession"("groupId", "status");

-- At most ONE active session per group, enforced by the database rather than only by the
-- route that opens sessions. Two concurrent "Start Fresh Session" taps from both partners
-- would otherwise race and leave the group with two live sessions and a split ledger.
CREATE UNIQUE INDEX "LedgerSession_one_active_per_group"
    ON "ledger"."LedgerSession"("groupId") WHERE "status" = 'active';

ALTER TABLE "ledger"."LedgerSession"
    ADD CONSTRAINT "LedgerSession_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── LedgerTransaction ───────────────────────────────────────────────────────
CREATE TABLE "ledger"."LedgerTransaction" (
    "id"          TEXT NOT NULL,
    "groupId"     TEXT NOT NULL,
    "sessionId"   TEXT NOT NULL,
    "ownerId"     TEXT NOT NULL,
    "type"        TEXT NOT NULL,
    "category"    TEXT NOT NULL,
    "amount"      DECIMAL(14,2) NOT NULL,
    "date"        DATE NOT NULL,
    "notes"       TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    "deletedById" TEXT,
    "deletedAt"   TIMESTAMP(3),

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LedgerTransaction_groupId_sessionId_idx" ON "ledger"."LedgerTransaction"("groupId", "sessionId");
CREATE INDEX "LedgerTransaction_groupId_deletedAt_idx" ON "ledger"."LedgerTransaction"("groupId", "deletedAt");
CREATE INDEX "LedgerTransaction_groupId_date_idx" ON "ledger"."LedgerTransaction"("groupId", "date");

-- Money must be positive and typed; the API validates both, and so does the database, because
-- "enforced server-side" should survive somebody one day calling the repository directly.
ALTER TABLE "ledger"."LedgerTransaction"
    ADD CONSTRAINT "LedgerTransaction_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "ledger"."LedgerTransaction"
    ADD CONSTRAINT "LedgerTransaction_type_valid" CHECK ("type" IN ('received', 'expense'));

ALTER TABLE "ledger"."LedgerTransaction"
    ADD CONSTRAINT "LedgerTransaction_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger"."LedgerTransaction"
    ADD CONSTRAINT "LedgerTransaction_sessionId_fkey" FOREIGN KEY ("sessionId")
    REFERENCES "ledger"."LedgerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── LedgerSettlement (frozen result of a closed session) ────────────────────
CREATE TABLE "ledger"."LedgerSettlement" (
    "id"              TEXT NOT NULL,
    "groupId"         TEXT NOT NULL,
    "sessionId"       TEXT NOT NULL,
    "seq"             INTEGER NOT NULL,
    "startedAt"       TIMESTAMP(3) NOT NULL,
    "closedAt"        TIMESTAMP(3) NOT NULL,
    "totalReceived"   DECIMAL(14,2) NOT NULL,
    "totalExpense"    DECIMAL(14,2) NOT NULL,
    "totalProfit"     DECIMAL(14,2) NOT NULL,
    "sharePerPartner" DECIMAL(14,2) NOT NULL,
    "fromUserId"      TEXT,
    "fromUserName"    TEXT NOT NULL DEFAULT '',
    "toUserId"        TEXT,
    "toUserName"      TEXT NOT NULL DEFAULT '',
    "amount"          DECIMAL(14,2) NOT NULL,
    "summary"         JSONB NOT NULL,
    "createdById"     TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LedgerSettlement_sessionId_key" ON "ledger"."LedgerSettlement"("sessionId");
CREATE UNIQUE INDEX "LedgerSettlement_groupId_seq_key" ON "ledger"."LedgerSettlement"("groupId", "seq");
CREATE INDEX "LedgerSettlement_groupId_idx" ON "ledger"."LedgerSettlement"("groupId");

ALTER TABLE "ledger"."LedgerSettlement"
    ADD CONSTRAINT "LedgerSettlement_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger"."LedgerSettlement"
    ADD CONSTRAINT "LedgerSettlement_sessionId_fkey" FOREIGN KEY ("sessionId")
    REFERENCES "ledger"."LedgerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── LedgerAuditLog (append-only) ────────────────────────────────────────────
CREATE TABLE "ledger"."LedgerAuditLog" (
    "id"        TEXT NOT NULL,
    "groupId"   TEXT NOT NULL,
    "sessionId" TEXT,
    "userId"    TEXT NOT NULL,
    "userName"  TEXT NOT NULL,
    "action"    TEXT NOT NULL,
    "entityId"  TEXT,
    "details"   JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LedgerAuditLog_groupId_createdAt_idx" ON "ledger"."LedgerAuditLog"("groupId", "createdAt");

ALTER TABLE "ledger"."LedgerAuditLog"
    ADD CONSTRAINT "LedgerAuditLog_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
