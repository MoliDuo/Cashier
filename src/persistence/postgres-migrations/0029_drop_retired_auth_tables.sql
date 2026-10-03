-- The previous release stopped using the login-address list, the single local
-- user and the session's link to it; admission is the identity provider's
-- decision and a session carries the provider's address. Their constraints and
-- indexes go with them. The session columns go first: its foreign key holds
-- `users` in place.
ALTER TABLE "sessions" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "authenticated_at";--> statement-breakpoint
DROP TABLE "login_emails";--> statement-breakpoint
DROP TABLE "users";
