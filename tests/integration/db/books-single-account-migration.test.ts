import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { getTestPool } from "../../setup";

const migration = readFileSync(
  "src/persistence/postgres-migrations/0048_books_and_single_account.sql",
  "utf8"
);

const defaultBookDrop = readFileSync(
  "src/persistence/postgres-migrations/0049_drop_book_default.sql",
  "utf8"
);

/** Applies 0049 the way the migration runner does, statement by statement. */
async function applyDefaultBookDrop(client: PoolClient): Promise<void> {
  for (const statement of defaultBookDrop.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed !== "") await client.query(trimmed);
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * The pre-0048 shape of the tables 0048 touches, reduced to the columns the
 * migration reads or drops. Two accounts on one ledger, records attributed to a
 * person, and keys attributed to a person: what 0045 and 0047 left behind.
 */
async function createPreMigrationSchema(client: PoolClient, schema: string) {
  await client.query(`
    CREATE SCHEMA ${schema};
    SET search_path TO ${schema};
    CREATE TABLE users (
      id uuid PRIMARY KEY,
      name text,
      email text NOT NULL,
      nickname text NOT NULL,
      gender text NOT NULL,
      time_zone text,
      email_verified timestamptz,
      password_hash text,
      auth_version integer NOT NULL DEFAULT 1,
      preferences jsonb NOT NULL DEFAULT '{"interfaceLanguage":"auto"}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE UNIQUE INDEX uniq_users_active_email ON users (lower(email)) WHERE deleted_at IS NULL;
    ALTER TABLE users ADD CONSTRAINT ck_users_nickname_length
      CHECK (length(btrim(nickname)) BETWEEN 1 AND 20);
    ALTER TABLE users ADD CONSTRAINT ck_users_gender CHECK (gender IN ('male', 'female'));
    ALTER TABLE users ADD CONSTRAINT ck_users_time_zone_length
      CHECK (time_zone IS NULL OR length(time_zone) <= 50);
    ALTER TABLE users ADD CONSTRAINT ck_users_auth_version_positive CHECK (auth_version > 0);

    CREATE TABLE ledgers (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
      main_currency varchar(3) NOT NULL DEFAULT 'CNY',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE UNIQUE INDEX uniq_ledgers_user_id ON ledgers (user_id) WHERE deleted_at IS NULL;

    CREATE TABLE source_documents (
      id uuid PRIMARY KEY,
      ledger_id uuid NOT NULL REFERENCES ledgers(id) ON DELETE cascade,
      attributed_user_id uuid NOT NULL,
      created_by_user_id uuid,
      CONSTRAINT source_documents_attributed_user_id_users_id_fk
        FOREIGN KEY (attributed_user_id) REFERENCES users(id),
      CONSTRAINT source_documents_created_by_user_id_users_id_fk
        FOREIGN KEY (created_by_user_id) REFERENCES users(id),
      title text,
      document_date date,
      deleted_at timestamptz
    );
    CREATE INDEX idx_source_documents_ledger_attribution
      ON source_documents (ledger_id, attributed_user_id) WHERE deleted_at IS NULL;

    CREATE TABLE service_credentials (
      id uuid PRIMARY KEY,
      ledger_id uuid NOT NULL REFERENCES ledgers(id) ON DELETE cascade,
      attributed_user_id uuid NOT NULL,
      name text NOT NULL,
      CONSTRAINT service_credentials_attributed_user_id_users_id_fk
        FOREIGN KEY (attributed_user_id) REFERENCES users(id),
      token_hash text,
      deleted_at timestamptz
    );

    CREATE TABLE email_change_challenges (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
      new_email text NOT NULL
    );
  `);
}

/** Runs `body` against a throwaway schema on one connection, then rolls back. */
async function withSchema(body: (client: PoolClient) => Promise<void>) {
  const client = await getTestPool().connect();
  const schema = quoteIdentifier(`books_${crypto.randomUUID().replaceAll("-", "")}`);
  try {
    await client.query("BEGIN");
    await createPreMigrationSchema(client, schema);
    await body(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/**
 * The migration is written as `DO $$ ... $$` blocks and DDL separated by
 * Drizzle's breakpoint marker. Applying it statement by statement is what the
 * migration runner does, and it is the only way to exercise the guards.
 */
async function applyMigration(client: PoolClient): Promise<void> {
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed !== "") await client.query(trimmed);
  }
}

const OWNER_EMAIL = "xiangyu.moe.ac@gmail.com";
const PARTNER_EMAIL = "liangyilinhuaxue@163.com";
const OTHER_EMAIL = "someone@example.com";

interface Fixture {
  ownerId: string;
  partnerId: string;
  ledgerId: string;
}

async function seedCouple(
  client: PoolClient,
  override: { partnerTimeZone?: string | null; owner?: "owner" | "partner" } = {}
) {
  const ownerId = crypto.randomUUID();
  const partnerId = crypto.randomUUID();
  const ledgerId = crypto.randomUUID();
  await client.query(
    `INSERT INTO users (id, email, nickname, gender, time_zone, email_verified, created_at, updated_at)
     VALUES ($1, $2, 'A', 'male', 'Asia/Kuala_Lumpur', now(), '2026-01-01', '2026-01-01'),
            ($3, $4, 'B', 'female', $5, now(), '2026-02-01', '2026-02-01')`,
    [
      ownerId,
      OWNER_EMAIL,
      partnerId,
      PARTNER_EMAIL,
      override.partnerTimeZone === undefined ? "Asia/Shanghai" : override.partnerTimeZone,
    ]
  );
  // `bootstrap-couple.mjs` took the owner from `COUPLE_OWNER_USER_ID`, so the
  // live ledger can legitimately belong to either account.
  const ledgerOwner = override.owner === "partner" ? partnerId : ownerId;
  await client.query(`INSERT INTO ledgers (id, user_id) VALUES ($1, $2)`, [ledgerId, ledgerOwner]);
  return { ownerId, partnerId, ledgerId };
}

async function seedData(client: PoolClient, fixture: Fixture) {
  // Three records for the owner, two for the partner, and a key each.
  for (let index = 0; index < 3; index += 1) {
    await client.query(
      `INSERT INTO source_documents (id, ledger_id, attributed_user_id, created_by_user_id, title)
       VALUES ($1, $2, $3, $3, $4)`,
      [crypto.randomUUID(), fixture.ledgerId, fixture.ownerId, `owner ${index}`]
    );
  }
  for (let index = 0; index < 2; index += 1) {
    await client.query(
      `INSERT INTO source_documents (id, ledger_id, attributed_user_id, created_by_user_id, title)
       VALUES ($1, $2, $3, $3, $4)`,
      [crypto.randomUUID(), fixture.ledgerId, fixture.partnerId, `partner ${index}`]
    );
  }
  await client.query(
    `INSERT INTO service_credentials (id, ledger_id, attributed_user_id, name, token_hash)
     VALUES ($1, $2, $3, 'owner key', 'owner-hash'), ($4, $2, $5, 'partner key', 'partner-hash')`,
    [crypto.randomUUID(), fixture.ledgerId, fixture.ownerId, crypto.randomUUID(), fixture.partnerId]
  );
  await client.query(
    `INSERT INTO email_change_challenges (id, user_id, new_email) VALUES ($1, $2, $3)`,
    [crypto.randomUUID(), fixture.partnerId, "pending@example.com"]
  );
}

describe("0048 books and single account migration", () => {
  it("turns the two members into books and merges their accounts", async () => {
    await withSchema(async (client) => {
      const fixture = await seedCouple(client);
      await seedData(client, fixture);
      const before = await client.query(
        `SELECT attributed_user_id, count(*)::int AS count
           FROM source_documents GROUP BY attributed_user_id`
      );
      const byUser = new Map(
        before.rows.map((row) => [row.attributed_user_id as string, Number(row.count)])
      );

      await applyMigration(client);

      // Each record keeps the person it had: the person-books reuse the user ids.
      const books = await client.query(
        `SELECT id, name, time_zone, sort_order, is_default FROM books ORDER BY sort_order`
      );
      expect(books.rows).toEqual([
        {
          id: fixture.ownerId,
          name: "哞哞的",
          time_zone: "Asia/Kuala_Lumpur",
          sort_order: 1,
          is_default: false,
        },
        {
          id: fixture.partnerId,
          name: "梁梁的",
          time_zone: "Asia/Shanghai",
          sort_order: 2,
          is_default: false,
        },
        {
          id: expect.any(String),
          name: "共同支出",
          time_zone: null,
          sort_order: 3,
          is_default: true,
        },
      ]);

      const after = await client.query(
        `SELECT book_id, count(*)::int AS count
           FROM source_documents GROUP BY book_id`
      );
      const byBook = new Map(after.rows.map((row) => [row.book_id as string, Number(row.count)]));
      expect(byBook.get(fixture.ownerId)).toBe(byUser.get(fixture.ownerId));
      expect(byBook.get(fixture.partnerId)).toBe(byUser.get(fixture.partnerId));

      // Keys follow their owner's book.
      const keys = await client.query(
        `SELECT b.name AS book, c.name AS credential
           FROM service_credentials c JOIN books b ON b.id = c.book_id
          ORDER BY c.name`
      );
      expect(keys.rows).toEqual([
        { book: "哞哞的", credential: "owner key" },
        { book: "梁梁的", credential: "partner key" },
      ]);

      // One account with two addresses, and 梁梁's row is gone.
      const emails = await client.query(
        `SELECT e.email, e.user_id FROM login_emails e ORDER BY e.email`
      );
      // Sorted by address, so 163 sorts before gmail; both point at the account.
      expect(new Set(emails.rows.map((row) => row.email))).toEqual(
        new Set([OWNER_EMAIL, PARTNER_EMAIL])
      );
      expect(emails.rows.every((row) => row.user_id === fixture.ownerId)).toBe(true);
      const liveUsers = await client.query(
        `SELECT id, auth_version FROM users WHERE deleted_at IS NULL`
      );
      expect(liveUsers.rows).toEqual([{ id: fixture.ownerId, auth_version: 2 }]);

      // The pending challenge belonged to the row that is gone.
      const challenges = await client.query(
        `SELECT count(*)::int AS count FROM email_change_challenges`
      );
      expect(challenges.rows[0].count).toBe(0);

      // The per-person columns are gone, and the one-ledger cap with them.
      const columns = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'users'`
      );
      const names = columns.rows.map((row) => row.column_name as string);
      for (const dropped of ["email", "email_verified", "nickname", "gender", "time_zone"]) {
        expect(names).not.toContain(dropped);
      }
      const indexes = await client.query(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = current_schema() AND indexname = 'uniq_ledgers_user_id'`
      );
      expect(indexes.rows).toHaveLength(0);
    });
  });

  it("keeps a null member zone as a null book zone", async () => {
    await withSchema(async (client) => {
      const fixture = await seedCouple(client, { partnerTimeZone: null });
      await applyMigration(client);

      const partnerBook = await client.query(`SELECT time_zone FROM books WHERE id = $1`, [
        fixture.partnerId,
      ]);
      expect(partnerBook.rows[0].time_zone).toBeNull();
    });
  });

  it("keeps the live ledger when 梁梁 owns it", async () => {
    await withSchema(async (client) => {
      // `bootstrap-couple.mjs` set the live ledger's owner from the environment,
      // so it can point at the account this migration deletes. `ledgers.user_id`
      // cascades: without the hand-over first, the DELETE would take the ledger
      // and every record in it.
      const fixture = await seedCouple(client, { owner: "partner" });
      await seedData(client, fixture);
      const before = await client.query(
        `SELECT count(*)::int AS count FROM source_documents WHERE deleted_at IS NULL`
      );

      await applyMigration(client);

      const ledgers = await client.query(
        `SELECT id, user_id FROM ledgers WHERE deleted_at IS NULL`
      );
      expect(ledgers.rows).toEqual([{ id: fixture.ledgerId, user_id: fixture.ownerId }]);
      const after = await client.query(
        `SELECT count(*)::int AS count FROM source_documents WHERE deleted_at IS NULL`
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);
      // And the records are still attributable: the composite key validated.
      const books = await client.query(`SELECT count(*)::int AS count FROM books`);
      expect(books.rows[0].count).toBe(3);
    });
  });

  it("keeps 梁梁's soft-deleted ledger instead of cascading it away", async () => {
    await withSchema(async (client) => {
      const fixture = await seedCouple(client);
      await seedData(client, fixture);
      // The old merge left its own ledger behind, soft-deleted and owned by
      // 梁梁. It has no records, so it is not a stray that the guard refuses.
      const staleLedgerId = crypto.randomUUID();
      await client.query(`INSERT INTO ledgers (id, user_id, deleted_at) VALUES ($1, $2, now())`, [
        staleLedgerId,
        fixture.partnerId,
      ]);

      await applyMigration(client);

      const stale = await client.query(`SELECT user_id, deleted_at FROM ledgers WHERE id = $1`, [
        staleLedgerId,
      ]);
      expect(stale.rows).toHaveLength(1);
      expect(stale.rows[0].user_id).toBe(fixture.ownerId);
      expect(stale.rows[0].deleted_at).not.toBeNull();
    });
  });

  it("aborts when records sit outside the live ledger", async () => {
    await withSchema(async (client) => {
      const fixture = await seedCouple(client);
      await seedData(client, fixture);
      // A record in the soft-deleted ledger has no book the composite key could
      // accept, so the migration must refuse it before the DDL runs.
      const staleLedgerId = crypto.randomUUID();
      await client.query(`INSERT INTO ledgers (id, user_id, deleted_at) VALUES ($1, $2, now())`, [
        staleLedgerId,
        fixture.ownerId,
      ]);
      await client.query(
        `INSERT INTO source_documents (id, ledger_id, attributed_user_id, title)
         VALUES ($1, $2, $3, 'orphan')`,
        [crypto.randomUUID(), staleLedgerId, fixture.ownerId]
      );

      await client.query("SAVEPOINT guard");
      await expect(applyMigration(client)).rejects.toThrow(
        /cannot attribute 1 source_documents and 0 service_credentials row\(s\)/
      );
      await client.query("ROLLBACK TO SAVEPOINT guard");

      const books = await client.query(
        `SELECT count(*)::int AS count FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'books'`
      );
      expect(books.rows[0].count).toBe(0);
    });
  });

  it("enforces one default book and unique live names", async () => {
    await withSchema(async (client) => {
      await seedCouple(client);
      await applyMigration(client);
      const ledger = await client.query(`SELECT id FROM ledgers LIMIT 1`);
      await client.query("SAVEPOINT name_check");
      // A duplicate live name is refused.
      await expect(
        client.query(
          `INSERT INTO books (ledger_id, name, is_default) VALUES ($1, '共同支出', false)`,
          [ledger.rows[0].id]
        )
      ).rejects.toThrow(/uniq_books_active_name/);
      await client.query("ROLLBACK TO SAVEPOINT name_check");
      await client.query("SAVEPOINT default_check");
      // So is a second default: 总账 would have two landing books.
      await expect(
        client.query(
          `INSERT INTO books (ledger_id, name, is_default) VALUES ($1, '另一个', true)`,
          [ledger.rows[0].id]
        )
      ).rejects.toThrow(/uniq_books_default/);
      await client.query("ROLLBACK TO SAVEPOINT default_check");
      // The archived flag releases both: a retired book may reuse a name, and
      // may hold a stale default flag without blocking the live one.
      await client.query(
        `INSERT INTO books (ledger_id, name, is_default, archived_at)
         VALUES ($1, '共同支出', true, now()), ($2, '另一个', true, now())`,
        [ledger.rows[0].id, ledger.rows[0].id]
      );
    });
  });

  it("only runs its data steps on the couple database", async () => {
    await withSchema(async (client) => {
      // An empty database: the schema change must still apply, and nothing may
      // be inserted, so the setup wizard owns the first account.
      await applyMigration(client);

      const books = await client.query(`SELECT count(*)::int AS count FROM books`);
      const users = await client.query(`SELECT count(*)::int AS count FROM users`);
      expect(books.rows[0].count).toBe(0);
      expect(users.rows[0].count).toBe(0);

      const columns = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'source_documents' AND column_name IN ('book_id', 'attributed_user_id')`
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual(["book_id"]);
    });
  });

  it("aborts before any DDL when the expected members are missing", async () => {
    await withSchema(async (client) => {
      const ownerId = crypto.randomUUID();
      const ledgerId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, nickname, gender) VALUES ($1, $2, 'A', 'male')`,
        [ownerId, OWNER_EMAIL]
      );
      await client.query(`INSERT INTO ledgers (id, user_id) VALUES ($1, $2)`, [ledgerId, ownerId]);

      await client.query("SAVEPOINT guard");
      await expect(applyMigration(client)).rejects.toThrow(/0048 requires live users/);
      await client.query("ROLLBACK TO SAVEPOINT guard");

      // The guard runs before the first statement, so the old shape is intact:
      // a failed migration must leave a recoverable database behind.
      const books = await client.query(
        `SELECT count(*)::int AS count FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'books'`
      );
      expect(books.rows[0].count).toBe(0);
      const documents = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'source_documents'
            AND column_name = 'attributed_user_id'`
      );
      expect(documents.rows).toHaveLength(1);
    });
  });

  it("aborts when a third live account holds data", async () => {
    await withSchema(async (client) => {
      const fixture = await seedCouple(client);
      const outsiderId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, nickname, gender) VALUES ($1, $2, 'C', 'male')`,
        [outsiderId, OTHER_EMAIL]
      );
      await client.query(
        `INSERT INTO source_documents (id, ledger_id, attributed_user_id, title)
         VALUES ($1, $2, $3, 'outsider')`,
        [crypto.randomUUID(), fixture.ledgerId, outsiderId]
      );

      await client.query("SAVEPOINT guard");
      await expect(applyMigration(client)).rejects.toThrow(
        /live account\(s\) with data beyond the two expected members/
      );
      await client.query("ROLLBACK TO SAVEPOINT guard");
    });
  });

  it("aborts when more than one ledger is live", async () => {
    await withSchema(async (client) => {
      const fixture = await seedCouple(client);
      // The pre-0048 schema caps a person at one ledger, so the extra ledger
      // needs its own account to hang off.
      const otherId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, nickname, gender) VALUES ($1, $2, 'C', 'male')`,
        [otherId, OTHER_EMAIL]
      );
      await client.query(`INSERT INTO ledgers (id, user_id) VALUES ($1, $2)`, [
        crypto.randomUUID(),
        otherId,
      ]);

      await client.query("SAVEPOINT guard");
      await expect(applyMigration(client)).rejects.toThrow(
        /0048 requires exactly one live ledger, found 2/
      );
      await client.query("ROLLBACK TO SAVEPOINT guard");
      expect(fixture.ownerId).toBeTruthy();
    });
  });
  it("drops the 总账 default column and index in 0049, keeping the books", async () => {
    await withSchema(async (client) => {
      const fixture = await seedCouple(client);
      await applyMigration(client);

      // 0048 left 共同支出 as the default; 0049 retires the concept without
      // touching the rows.
      const before = await client.query(
        `SELECT count(*)::int AS count FROM books WHERE is_default`
      );
      expect(before.rows[0].count).toBe(1);
      await applyDefaultBookDrop(client);

      const columns = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'books'
            AND column_name = 'is_default'`
      );
      expect(columns.rows).toHaveLength(0);
      const index = await client.query(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = current_schema() AND indexname = 'uniq_books_default'`
      );
      expect(index.rows).toHaveLength(0);
      const books = await client.query(`SELECT count(*)::int AS count FROM books`);
      expect(books.rows[0].count).toBe(3);
      expect(fixture.ledgerId).toBeTruthy();
    });
  });
});
