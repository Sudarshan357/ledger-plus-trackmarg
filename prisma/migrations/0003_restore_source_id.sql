-- Lets a restored entry remember which backup row it came from.
--
-- Restore is additive - it never deletes or overwrites - which on its own would mean loading
-- the same backup twice doubled every figure in the ledger. Recording the source id and making
-- it unique per group turns a repeat restore into a no-op instead.

ALTER TABLE "ledger"."LedgerTransaction" ADD COLUMN "sourceId" TEXT;

-- Partial, so the many normal entries with a NULL sourceId do not collide with each other.
-- Scoped to the group as well as the id, so the same backup can be restored into two
-- different partnerships without the second one silently skipping everything.
CREATE UNIQUE INDEX "LedgerTransaction_groupId_sourceId_key"
    ON "ledger"."LedgerTransaction"("groupId", "sourceId") WHERE "sourceId" IS NOT NULL;
