import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { getTestPool } from "../../setup";

const migration = readFileSync(
  "src/persistence/postgres-migrations/0047_member_profiles.sql",
  "utf8"
);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * The pre-0047 shape of the tables the migration touches. The couple setup is
 * two accounts on one shared ledger, which is what 0045 left behind, and the
 * ledger settings change log watches a named column list that includes
 * `time_zone`.
 */
async function createPreMigrationSchema(client: PoolClient, schema: string) {
  await client.query(`
    CREATE SCHEMA ${schema};
    SET search_path TO ${schema};
    CREATE TABLE users (
      id uuid PRIMARY KEY,
      name text,
      email text NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      deleted_at timestamptz
    );
    CREATE TABLE ledgers (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      ai_language text NOT NULL DEFAULT 'zh-CN',
      preferred_currencies varchar(3)[] NOT NULL DEFAULT '{}',
      main_currency varchar(3) NOT NULL DEFAULT 'CNY',
      collapse_entries_default boolean NOT NULL DEFAULT false,
      ai_custom_prompt text NOT NULL DEFAULT '',
      time_zone text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_ledgers_time_zone_length CHECK (time_zone IS NULL OR length(time_zone) <= 50)
    );
    CREATE FUNCTION record_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RETURN coalesce(NEW, OLD);
    END $$;
    CREATE TRIGGER trg_ledgers_settings_change_log
    AFTER UPDATE OF ai_language, preferred_currencies, main_currency, collapse_entries_default,
      ai_custom_prompt, time_zone ON ledgers
    FOR EACH ROW EXECUTE FUNCTION record_ledger_change('settings');
  `);
}

/** Runs `body` against a throwaway schema on one connection, then rolls back. */
async function withSchema(body: (client: PoolClient) => Promise<void>) {
  const client = await getTestPool().connect();
  const schema = quoteIdentifier(`member_profiles_${crypto.randomUUID().replaceAll("-", "")}`);
  try {
    await client.query("BEGIN");
    await createPreMigrationSchema(client, schema);
    await body(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

describe("member profiles migration", () => {
  it("numbers the members, copies the ledger zone, and drops the ledger column", async () => {
    const owner = crypto.randomUUID();
    const partner = crypto.randomUUID();

    await withSchema(async (client) => {
      // The owner is created first; the migration's ordering must make them A.
      await client.query(
        `INSERT INTO users (id, email, created_at, updated_at) VALUES
           ($1, 'owner@example.test', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
           ($2, 'partner@example.test', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')`,
        [owner, partner]
      );
      await client.query(
        `INSERT INTO ledgers (id, user_id, time_zone, updated_at)
         VALUES ($1, $2, 'Asia/Kuala_Lumpur', '2026-03-01T00:00:00Z')`,
        [crypto.randomUUID(), owner]
      );

      await client.query(migration);

      const members = await client.query<{
        id: string;
        nickname: string;
        gender: string;
        time_zone: string | null;
      }>("SELECT id, nickname, gender, time_zone FROM users ORDER BY created_at");
      expect(members.rows).toEqual([
        { id: owner, nickname: "A", gender: "male", time_zone: "Asia/Kuala_Lumpur" },
        { id: partner, nickname: "B", gender: "female", time_zone: "Asia/Kuala_Lumpur" },
      ]);

      const columns = await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'ledgers'"
      );
      expect(columns.rows.map((row) => row.column_name)).not.toContain("time_zone");
      const trigger = await client.query<{ definition: string }>(
        `SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
          WHERE tgname = 'trg_ledgers_settings_change_log' AND NOT tgisinternal`
      );
      expect(trigger.rows[0]?.definition).not.toContain("time_zone");
    });
  });

  it("rejects a nickname of only spaces and an unknown gender", async () => {
    await withSchema(async (client) => {
      const userId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, created_at, updated_at)
         VALUES ($1, 'a@example.test', now(), now())`,
        [userId]
      );
      await client.query(migration);

      // Each rejected statement aborts the surrounding transaction, so every
      // check runs in its own savepoint and leaves the rest of the test usable.
      const rejects = async (sql: string, params: unknown[], pattern: RegExp) => {
        await client.query("SAVEPOINT check_constraint");
        await expect(client.query(sql, params)).rejects.toThrow(pattern);
        await client.query("ROLLBACK TO SAVEPOINT check_constraint");
      };
      await rejects(
        "UPDATE users SET nickname = '   ' WHERE id = $1",
        [userId],
        /ck_users_nickname_length/
      );
      await rejects(
        "UPDATE users SET nickname = $2 WHERE id = $1",
        [userId, "x".repeat(21)],
        /ck_users_nickname_length/
      );
      await rejects("UPDATE users SET gender = 'other' WHERE id = $1", [userId], /ck_users_gender/);
      // Trimming happens at the edges, so a 20-character name still fits.
      await client.query("UPDATE users SET nickname = $2 WHERE id = $1", [userId, "n".repeat(20)]);
    });
  });

  it("leaves every member automatic when no ledger set a zone", async () => {
    await withSchema(async (client) => {
      const userId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, created_at, updated_at)
         VALUES ($1, 'a@example.test', now(), now())`,
        [userId]
      );
      await client.query("INSERT INTO ledgers (id, user_id, time_zone) VALUES ($1, $1, NULL)", [
        crypto.randomUUID(),
      ]);

      await client.query(migration);

      const members = await client.query<{ time_zone: string | null }>(
        "SELECT time_zone FROM users"
      );
      expect(members.rows).toEqual([{ time_zone: null }]);
    });
  });
});
