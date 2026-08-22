-- Confirming a payment now goes through the same two-partner approval as closing a session or
-- amending a settled one.
--
-- "The money changed hands" is a claim about the real world that the other partner is the only
-- one able to verify, so one person asserting it alone was the odd one out among the
-- settlement actions.

ALTER TABLE "ledger"."LedgerApproval" DROP CONSTRAINT "LedgerApproval_kind_valid";
ALTER TABLE "ledger"."LedgerApproval"
    ADD CONSTRAINT "LedgerApproval_kind_valid"
    CHECK ("kind" IN ('close_session', 'amend_settlement', 'mark_paid'));
