-- Passwords and signed-cookie sessions are gone, and accounts are created from
-- the command line instead of /setup. No released code reads these columns; the
-- previous release reads setup_state only while no account exists, which an
-- instance with an account never reaches again.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "ck_users_auth_version_positive";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "auth_version";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_updated_at";--> statement-breakpoint
DROP TABLE IF EXISTS "setup_state";
