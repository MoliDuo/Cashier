-- One-time codes are spent when they verify, not reserved.
--
-- Verifying used to mark `verified_at` and leave the row behind, so that a
-- failure in the step after sign-in could unmark it and let the same code be
-- used again. That step is "does the shared ledger exist", which after setup
-- it always does, so the release path guarded a failure that cannot happen.
-- The verify now deletes the row under the same conditions it just checked,
-- which is what made two simultaneous verifies safe in the first place.
DROP INDEX "idx_otp_tokens_verified";--> statement-breakpoint
ALTER TABLE "otp_tokens" DROP COLUMN "verified_at";
