-- Member profiles: a nickname and a gender for each person, and the ledger's
-- single time zone moved onto every user.
--
-- 0045 collapsed the two accounts onto one shared book, which left
-- `ledgers.time_zone` as one setting for two people who live in different
-- places. Each member now carries their own zone; NULL still means "use this
-- device's zone", exactly as it did on the ledger.
--
-- Existing rows are numbered by `created_at, id`, so the first-created account
-- (the configured owner) reads A/male and the second B/female. Both are
-- editable in 设置 afterwards: the defaults only need to be distinct and
-- stable, not correct. Deleted accounts take part in the numbering so a later
-- cleanup cannot shift the two live members.
ALTER TABLE "users" ADD COLUMN "nickname" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "time_zone" text;--> statement-breakpoint
WITH numbered AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS position
  FROM "users"
)
UPDATE "users" AS u
   SET "nickname" = CASE WHEN n.position % 2 = 1 THEN 'A' ELSE 'B' END,
       "gender" = CASE WHEN n.position % 2 = 1 THEN 'male' ELSE 'female' END
  FROM numbered AS n
 WHERE n."id" = u."id";--> statement-breakpoint
UPDATE "users"
   SET "time_zone" = (
     SELECT "time_zone" FROM "ledgers"
      WHERE "time_zone" IS NOT NULL
      ORDER BY "updated_at" DESC
      LIMIT 1
   );--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "nickname" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "gender" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ck_users_nickname_length" CHECK (length(btrim("users"."nickname")) BETWEEN 1 AND 20);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ck_users_gender" CHECK ("users"."gender" IN ('male', 'female'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ck_users_time_zone_length" CHECK ("users"."time_zone" IS NULL OR length("users"."time_zone") <= 50);--> statement-breakpoint
-- The ledger settings change-log trigger names the columns it watches, and
-- `time_zone` is one of them. It is redefined without that column before the
-- column itself goes, so the drop does not have to cascade onto the trigger.
-- The remaining settings columns still publish a settings change.
DROP TRIGGER IF EXISTS "trg_ledgers_settings_change_log" ON "ledgers";--> statement-breakpoint
CREATE TRIGGER "trg_ledgers_settings_change_log"
AFTER UPDATE OF "ai_language", "preferred_currencies", "main_currency", "collapse_entries_default", "ai_custom_prompt" ON "ledgers"
FOR EACH ROW EXECUTE FUNCTION record_ledger_change('settings');--> statement-breakpoint
ALTER TABLE "ledgers" DROP CONSTRAINT "ck_ledgers_time_zone_length";--> statement-breakpoint
ALTER TABLE "ledgers" DROP COLUMN "time_zone";
