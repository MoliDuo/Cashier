-- The identity provider decides who may sign in, so the application keeps no
-- account of its own: a session records the address the provider vouched for,
-- and no longer names a user. The model stops using `user_id` and
-- `authenticated_at` in this release; the previous release still inserts both,
-- so they stay in place, relaxed so the new release can insert a row without
-- them. A later migration drops them, with `users` and `login_emails`.
ALTER TABLE "sessions" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "authenticated_at" SET DEFAULT now();
