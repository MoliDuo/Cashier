-- Sign-in moved to an OIDC provider: it vouches for the address, so nothing here
-- verifies one any more. Passkeys, sign-in and add-address codes, and the
-- per-IP rate limits that only guarded them go; so does the proof-of-ownership
-- timestamp on a login address. Existing login addresses stay as they are.
DROP TABLE "passkeys";--> statement-breakpoint
DROP TABLE "webauthn_challenges";--> statement-breakpoint
DROP TABLE "sign_in_challenges";--> statement-breakpoint
DROP TABLE "login_email_challenges";--> statement-breakpoint
DROP TABLE "rate_limit_buckets";--> statement-breakpoint
ALTER TABLE "login_emails" DROP COLUMN "verified_at";
