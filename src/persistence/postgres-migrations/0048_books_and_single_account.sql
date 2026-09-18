-- From two members to one account with 分账 (books).
--
-- Before this migration the app was capped at two people: `users` held one row
-- per person, three `COUPLE_*` env UUIDs decided who could sign in, and every
-- record was attributed to a person through `source_documents.attributed_user_id`
-- / `service_credentials.attributed_user_id`. The owner's model is one account
-- with a set of login addresses, and every record belonging to one 分账 that is
-- read together as 总账. So attribution becomes a book, and the two people become
-- the two books 哞哞的 / 梁梁的 plus a new 共同支出.
--
-- The person-books deliberately reuse the two `users.id` values. `book_id` is
-- the old `attributed_user_id` renamed, so the backfill is the identity: the
-- existing rows keep exactly the person they had, and no row is rewritten. Rows
-- are matched by email, never by position, so a renamed or reordered account
-- still maps correctly.
--
-- Two shapes are accepted, and the schema change is identical for both:
--   * an empty database, where the first-run wizard creates the account, the
--     ledger and the books afterwards. Only the DDL runs.
--   * the live couple database, where the two members' records are reattributed
--     to their books and the second account is merged into the first.
-- Anything else aborts before any DDL, so a database that matches neither shape
-- is left untouched.
--
-- Irreversible: 梁梁's user row, `users.email`, and the per-person profile
-- columns are dropped. Back up and rehearse before running this.
--
-- Order matters three times over: the person-books must exist before a record
-- can be validated against one; the old person foreign keys must be gone before
-- 梁梁's row is deleted; and the new composite keys must be added after both.
DO $$
DECLARE
  live_ledgers integer;
  live_users integer;
  owner_id uuid;
  partner_id uuid;
  stray_owners integer;
  owner_email constant text := 'xiangyu.moe.ac@gmail.com';
  partner_email constant text := 'liangyilinhuaxue@163.com';
BEGIN
  SELECT count(*) INTO live_ledgers FROM ledgers WHERE deleted_at IS NULL;
  SELECT count(*) INTO live_users FROM users WHERE deleted_at IS NULL;

  IF live_users = 0 AND live_ledgers = 0 THEN
    -- A fresh install: nothing to migrate, and the wizard populates it later.
    RETURN;
  END IF;

  IF live_ledgers <> 1 THEN
    RAISE EXCEPTION
      '0048 requires exactly one live ledger, found %', live_ledgers
      USING HINT = 'Delete or merge the extra ledgers before running this migration.';
  END IF;

  SELECT id INTO owner_id FROM users
   WHERE lower(email) = owner_email AND deleted_at IS NULL;
  SELECT id INTO partner_id FROM users
   WHERE lower(email) = partner_email AND deleted_at IS NULL;
  IF owner_id IS NULL OR partner_id IS NULL THEN
    RAISE EXCEPTION
      '0048 requires live users % and %; run it against the couple database it was written for',
      owner_email, partner_email
      USING HINT = 'Restore the pre-migration backup, or adapt the migration to this database first.';
  END IF;

  -- A third live account with records would have nowhere to go: its records
  -- would have to be attributed to one of the two person-books.
  SELECT count(*) INTO stray_owners
    FROM users u
   WHERE u.deleted_at IS NULL
     AND u.id NOT IN (owner_id, partner_id)
     AND (
       EXISTS (SELECT 1 FROM ledgers l WHERE l.user_id = u.id AND l.deleted_at IS NULL)
       OR EXISTS (SELECT 1 FROM source_documents d WHERE d.attributed_user_id = u.id)
       OR EXISTS (SELECT 1 FROM service_credentials c WHERE c.attributed_user_id = u.id)
     );
  IF stray_owners > 0 THEN
    RAISE EXCEPTION
      '0048 found % live account(s) with data beyond the two expected members', stray_owners
      USING HINT = 'Reassign or remove those records before running this migration.';
  END IF;
END $$;--> statement-breakpoint

CREATE TABLE "books" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ledger_id" uuid NOT NULL,
  "name" text NOT NULL,
  "time_zone" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "books_ledger_id_ledgers_id_fk"
    FOREIGN KEY ("ledger_id") REFERENCES "ledgers"("id") ON DELETE cascade,
  CONSTRAINT "ck_books_name_length"
    CHECK (length(btrim("books"."name")) BETWEEN 1 AND 20),
  CONSTRAINT "ck_books_time_zone_length"
    CHECK ("books"."time_zone" IS NULL OR length("books"."time_zone") <= 50)
);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_books_ledger_id_id" ON "books" ("ledger_id", "id");--> statement-breakpoint
CREATE INDEX "idx_books_active_sort"
  ON "books" ("ledger_id", "sort_order", "created_at", "id")
  WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_books_active_name"
  ON "books" ("ledger_id", "name")
  WHERE "archived_at" IS NULL;--> statement-breakpoint
-- 总账 needs exactly one landing book for records that are not aimed at a
-- specific one. A partial unique index is what keeps it unique while archived
-- books can hold stale flags.
CREATE UNIQUE INDEX "uniq_books_default"
  ON "books" ("ledger_id")
  WHERE "is_default" AND "archived_at" IS NULL;--> statement-breakpoint

-- The login addresses. On a fresh install this stays empty until the wizard runs.
CREATE TABLE "login_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "email" text NOT NULL,
  "email_verified" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "login_emails_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_login_emails_email" ON "login_emails" (lower("email"));--> statement-breakpoint
CREATE INDEX "idx_login_emails_user_id" ON "login_emails" ("user_id");--> statement-breakpoint

-- The first-run setup code, while setup is pending. It is a table rather than
-- process state because a production build renders `/setup` and runs its server
-- action in separate realms, so the two cannot share a module or process value;
-- the database is what they already share. The boolean primary key can only be
-- true, so the table holds at most one row, and the wizard deletes it as part of
-- creating the account.
CREATE TABLE "setup_state" (
  "id" boolean PRIMARY KEY DEFAULT true NOT NULL,
  "code_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ck_setup_state_single_row" CHECK ("id")
);--> statement-breakpoint

-- `attributed_user_id` is now `book_id`: the rename is the backfill, because the
-- person-books are given the user ids. `created_by_user_id` recorded who typed a
-- record in, and the owner's model has no such audit.
--
-- The old person foreign keys go before the data block below, because deleting
-- 梁梁's user row needs the records to point at her book, not at her user id.
ALTER TABLE "source_documents" RENAME COLUMN "attributed_user_id" TO "book_id";--> statement-breakpoint
ALTER TABLE "source_documents" DROP COLUMN "created_by_user_id";--> statement-breakpoint
ALTER TABLE "source_documents"
  DROP CONSTRAINT IF EXISTS "source_documents_attributed_user_id_users_id_fk";--> statement-breakpoint
DROP INDEX "idx_source_documents_ledger_attribution";--> statement-breakpoint
CREATE INDEX "idx_source_documents_ledger_book"
  ON "source_documents" ("ledger_id", "book_id")
  WHERE "deleted_at" IS NULL;--> statement-breakpoint

ALTER TABLE "service_credentials" RENAME COLUMN "attributed_user_id" TO "book_id";--> statement-breakpoint
ALTER TABLE "service_credentials"
  DROP CONSTRAINT IF EXISTS "service_credentials_attributed_user_id_users_id_fk";--> statement-breakpoint
CREATE INDEX "idx_service_credentials_ledger_book"
  ON "service_credentials" ("ledger_id", "book_id");--> statement-breakpoint

-- The couple database's data: its people become books, and its two accounts
-- become one with two login addresses. A fresh install has no live ledger and
-- returns from this block without writing anything.
DO $$
DECLARE
  live_ledgers integer;
  owner_id uuid;
  partner_id uuid;
  owner_email constant text := 'xiangyu.moe.ac@gmail.com';
  partner_email constant text := 'liangyilinhuaxue@163.com';
BEGIN
  SELECT count(*) INTO live_ledgers FROM ledgers WHERE deleted_at IS NULL;
  IF live_ledgers = 0 THEN
    RETURN;
  END IF;

  SELECT id INTO owner_id FROM users
   WHERE lower(email) = owner_email AND deleted_at IS NULL;
  SELECT id INTO partner_id FROM users
   WHERE lower(email) = partner_email AND deleted_at IS NULL;

  -- 哞哞的 / 梁梁的 keep each member's own zone, so an upload through their own
  -- key is still dated in their day. The person-books reuse the user ids, which
  -- is exactly what the renamed `book_id` columns already point at.
  -- 共同支出 is the 总账 default and has no zone of its own: it falls back to the
  -- server date, as a null member zone did.
  INSERT INTO books (id, ledger_id, name, time_zone, sort_order, is_default)
  SELECT owner_id, l.id, '哞哞的', ou.time_zone, 1, false
    FROM ledgers l
   CROSS JOIN users ou
   WHERE l.deleted_at IS NULL AND ou.id = owner_id;

  INSERT INTO books (id, ledger_id, name, time_zone, sort_order, is_default)
  SELECT partner_id, l.id, '梁梁的', pu.time_zone, 2, false
    FROM ledgers l
   CROSS JOIN users pu
   WHERE l.deleted_at IS NULL AND pu.id = partner_id;

  INSERT INTO books (ledger_id, name, time_zone, sort_order, is_default)
  SELECT l.id, '共同支出', NULL, 3, true
    FROM ledgers l
   WHERE l.deleted_at IS NULL;

  -- Both addresses point at the account that survives. 梁梁's password and
  -- preferences do not: there is one password and one set of preferences now.
  INSERT INTO login_emails (user_id, email, email_verified, created_at, updated_at)
  SELECT owner_id, u.email, u.email_verified, u.created_at, u.updated_at
    FROM users u WHERE u.id = owner_id;

  INSERT INTO login_emails (user_id, email, email_verified, created_at, updated_at)
  SELECT owner_id, u.email, u.email_verified, u.created_at, u.updated_at
    FROM users u WHERE u.id = partner_id;

  -- Sign everyone out once: the surviving account's `auth_version` changes, so a
  -- session minted for 梁梁's row cannot be replayed against the merged account.
  UPDATE users SET auth_version = auth_version + 1 WHERE id = owner_id;

  -- A pending "add this address" challenge belongs to the row that is going
  -- away, and the address is what it wanted to add: it cannot outlive its owner.
  DELETE FROM email_change_challenges WHERE user_id = partner_id;

  -- Records and keys already point at the person-books, so the row is
  -- unreferenced by the time the composite keys below are validated.
  DELETE FROM users WHERE id = partner_id;
END $$;--> statement-breakpoint

-- The person-books now hold every record, so the composite keys validate.
ALTER TABLE "source_documents" ADD CONSTRAINT "fk_source_documents_book_ledger"
  FOREIGN KEY ("ledger_id", "book_id") REFERENCES "books"("ledger_id", "id");--> statement-breakpoint
ALTER TABLE "service_credentials" ADD CONSTRAINT "fk_service_credentials_book_ledger"
  FOREIGN KEY ("ledger_id", "book_id") REFERENCES "books"("ledger_id", "id");--> statement-breakpoint

-- The per-person profile columns are gone: the address lives in `login_emails`,
-- and the zone lives on the book.
DROP INDEX "uniq_users_active_email";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "ck_users_nickname_length";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "ck_users_gender";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "ck_users_time_zone_length";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "nickname";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "gender";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "time_zone";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email_verified";--> statement-breakpoint

-- `uniq_ledgers_user_id` was what capped a person at one ledger; the app now
-- finds the single live ledger by query, so the constraint is only in the way of
-- a future second ledger.
DROP INDEX "uniq_ledgers_user_id";
