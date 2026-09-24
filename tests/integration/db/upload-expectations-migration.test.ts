import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { getTestPool } from "../../setup";

const migration = readFileSync(
  "src/persistence/postgres-migrations/0054_retire_legacy_upload_sessions.sql",
  "utf8"
);
async function withLegacySchema(body: (client: PoolClient) => Promise<void>) {
  const client = await getTestPool().connect();
  const schema = "upload_retirement_" + crypto.randomUUID().replaceAll("-", "");
  try {
    await client.query("BEGIN");
    await client.query("CREATE SCHEMA " + schema + "; SET LOCAL search_path TO " + schema);
    await client.query(
      [
        "CREATE TABLE upload_sessions (id uuid PRIMARY KEY, ledger_id uuid NOT NULL, created_at timestamptz, expires_at timestamptz)",
        "CREATE TABLE stored_files (id uuid PRIMARY KEY)",
        "CREATE TABLE upload_session_files (upload_session_id uuid REFERENCES upload_sessions ON DELETE CASCADE, target_id uuid, stored_file_id uuid REFERENCES stored_files, expected_content_type text, expected_byte_size bigint)",
        "CREATE TABLE object_cleanup_jobs (storage_key text UNIQUE, upload_session_id uuid REFERENCES upload_sessions ON DELETE CASCADE, next_attempt_at timestamptz, created_at timestamptz)",
      ].join(";")
    );
    await body(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
async function apply(client: PoolClient) {
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}
async function seed(client: PoolClient, createdAt: Date, expiresAt: Date) {
  const sessionId = crypto.randomUUID(),
    ledgerId = crypto.randomUUID();
  const targetId = crypto.randomUUID(),
    fileId = crypto.randomUUID();
  await client.query("INSERT INTO upload_sessions VALUES ($1,$2,$3,$4)", [
    sessionId,
    ledgerId,
    createdAt,
    expiresAt,
  ]);
  await client.query("INSERT INTO stored_files VALUES ($1)", [fileId]);
  await client.query("INSERT INTO upload_session_files VALUES ($1,$2,$3,NULL,NULL)", [
    sessionId,
    targetId,
    fileId,
  ]);
  return { sessionId, fileId, key: "temporary/" + ledgerId + "/" + sessionId + "/" + targetId };
}

describe("0054 upload expectation retirement", () => {
  it("preserves durable files and detaches existing cleanup work before retiring expired legacy sessions", async () => {
    await withLegacySchema(async (client) => {
      const old = new Date(Date.now() - 3 * 86400000);
      const fixture = await seed(client, old, old);
      await client.query("INSERT INTO object_cleanup_jobs VALUES ($1,$2,now(),now())", [
        fixture.key,
        fixture.sessionId,
      ]);
      await apply(client);
      expect((await client.query("SELECT * FROM upload_sessions")).rows).toEqual([]);
      expect((await client.query("SELECT * FROM upload_session_files")).rows).toEqual([]);
      expect((await client.query("SELECT * FROM stored_files")).rows).toEqual([
        { id: fixture.fileId },
      ]);
      expect(
        (await client.query("SELECT storage_key,upload_session_id FROM object_cleanup_jobs")).rows
      ).toEqual([{ storage_key: fixture.key, upload_session_id: null }]);
      const constraints = await client.query(
        "SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='upload_session_files' AND column_name LIKE 'expected_%'"
      );
      expect(constraints.rows).toHaveLength(2);
      expect(constraints.rows.every((row) => row.is_nullable === "NO")).toBe(true);
    });
  });
  it.each(["recent", "unexpired"])(
    "refuses %s legacy sessions without deleting their data",
    async (kind) => {
      await withLegacySchema(async (client) => {
        const old = new Date(Date.now() - 3 * 86400000);
        await seed(
          client,
          kind === "recent" ? new Date() : old,
          kind === "unexpired" ? new Date(Date.now() + 86400000) : old
        );
        await client.query("SAVEPOINT before_migration");
        await expect(apply(client)).rejects.toThrow("compatibility window");
        await client.query("ROLLBACK TO SAVEPOINT before_migration");
        expect((await client.query("SELECT * FROM upload_sessions")).rows).toHaveLength(1);
        expect((await client.query("SELECT * FROM stored_files")).rows).toHaveLength(1);
        expect((await client.query("SELECT * FROM object_cleanup_jobs")).rows).toHaveLength(0);
      });
    }
  );
  it("leaves current sessions intact and queues previously untracked temporary objects", async () => {
    await withLegacySchema(async (client) => {
      const old = new Date(Date.now() - 3 * 86400000);
      const legacy = await seed(client, old, old);
      const current = await seed(client, new Date(), new Date(Date.now() + 86400000));
      await client.query(
        "UPDATE upload_session_files SET expected_content_type='image/png', expected_byte_size=42 WHERE upload_session_id=$1",
        [current.sessionId]
      );
      await apply(client);
      expect((await client.query("SELECT id FROM upload_sessions")).rows).toEqual([
        { id: current.sessionId },
      ]);
      expect((await client.query("SELECT storage_key FROM object_cleanup_jobs")).rows).toEqual([
        { storage_key: legacy.key },
      ]);
      expect((await client.query("SELECT * FROM stored_files")).rows).toHaveLength(2);
    });
  });
});
