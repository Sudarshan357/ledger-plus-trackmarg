-- The identity tables Ledger+ used to borrow, and now owns.
--
-- Originally Ledger+ ran against the Trackmarg transport app's database and read and wrote its
-- `public.Group`, `public.User` and `public.Session` directly - that was what made a Ledger+
-- partnership literally the same record as a Trackmarg group. On its own database there is no
-- transport app to borrow from, so it has to create them itself.
--
-- Numbered 0000 so it runs before 0001, which declares foreign keys pointing at these tables.
--
-- Every statement is idempotent. Applied to the OLD shared database this is a complete no-op:
-- the tables are already there and owned by the transport app, and nothing here would touch
-- or alter them. That matters because it means pointing back at the old database stays a
-- one-line change rather than a rebuild.

-- Mirrors the transport app's Role enum. Ledger+ only ever writes 'admin' (both partners are
-- equal peers), but the column is the same shape so the two schemas stay recognisable.
DO $$
BEGIN
    CREATE TYPE "public"."Role" AS ENUM ('admin', 'driver');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "public"."Group" (
    "id"                TEXT NOT NULL,
    "code"              VARCHAR(12) NOT NULL,
    "name"              TEXT NOT NULL,
    "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1,
    "frozen"            BOOLEAN NOT NULL DEFAULT false,
    "maxDrivers"        INTEGER,
    "maxAdmins"         INTEGER,
    "maxBillsPerDay"    INTEGER,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Group_code_key" ON "public"."Group"("code");

CREATE TABLE IF NOT EXISTS "public"."User" (
    "id"           TEXT NOT NULL,
    "groupId"      TEXT NOT NULL,
    "role"         "public"."Role" NOT NULL,
    "name"         TEXT NOT NULL,
    "phone"        TEXT NOT NULL,
    "userCode"     TEXT,
    "passwordHash" TEXT NOT NULL,
    "email"        TEXT,
    "active"       BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_userCode_key" ON "public"."User"("userCode");
-- Sign-in is by group code + phone, so the pair must be unique within a partnership.
CREATE UNIQUE INDEX IF NOT EXISTS "User_groupId_phone_key" ON "public"."User"("groupId", "phone");
CREATE INDEX IF NOT EXISTS "User_groupId_idx" ON "public"."User"("groupId");

CREATE TABLE IF NOT EXISTS "public"."Session" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "revokedAt"  TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent"  TEXT,
    "ip"         TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "public"."Session"("tokenHash");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "public"."Session"("userId");
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "public"."Session"("expiresAt");

-- Foreign keys, added separately so a re-run does not fail on one that already exists.
DO $$
BEGIN
    ALTER TABLE "public"."User"
        ADD CONSTRAINT "User_groupId_fkey" FOREIGN KEY ("groupId")
        REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    ALTER TABLE "public"."Session"
        ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;
