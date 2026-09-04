-- Editing an entry more than 10 minutes after it was recorded now goes through the same
-- two-partner approval as closing a session, amending a settled one, or confirming a payment -
-- see backend/src/routes/transactions.routes.ts for the free-edit window this backs.
--
-- Additive only, and confined to the `ledger` schema like everything else Ledger+ owns.

ALTER TABLE "ledger"."LedgerApproval" ADD COLUMN "transactionId" TEXT;

ALTER TABLE "ledger"."LedgerApproval" DROP CONSTRAINT "LedgerApproval_kind_valid";
ALTER TABLE "ledger"."LedgerApproval"
    ADD CONSTRAINT "LedgerApproval_kind_valid"
    CHECK ("kind" IN ('close_session', 'amend_settlement', 'mark_paid', 'edit_transaction'));
