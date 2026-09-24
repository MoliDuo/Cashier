import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { getTestDb, getTestPool } from "../../setup";
import { createTestSourceDocument, createTestUserWithLedger } from "../../helpers/schema-setup";

const migration = readFileSync(
  "src/persistence/postgres-migrations/0056_prepare_retired_column_drop.sql",
  "utf8"
);

/**
 * Replays 0056 over seeded rows. Every statement is either idempotent or only
 * touches the seeded soft-deleted rows, so the replay runs against the already
 * migrated test schema inside a transaction that is rolled back afterwards.
 */
async function replayMigration(body: (client: PoolClient) => Promise<void>) {
  const client = await getTestPool().connect();
  try {
    await client.query("BEGIN");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await client.query(statement);
    }
    await body(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function seedRetiredAccount(): Promise<{ userId: string; ledgerId: string; key: string }> {
  const userId = crypto.randomUUID();
  const ledgerId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const key = `${ledgerId}/stored/${fileId}`;
  const pool = getTestPool();
  await pool.query(
    "INSERT INTO users (id, deleted_at, created_at, updated_at) VALUES ($1, now(), now(), now())",
    [userId]
  );
  await pool.query(
    "INSERT INTO login_emails (user_id, email, email_verified, created_at, updated_at) VALUES ($1, $2, now(), now(), now())",
    [userId, `retired-${userId}@example.com`]
  );
  await pool.query(
    "INSERT INTO ledgers (id, user_id, deleted_at, created_at, updated_at) VALUES ($1, $2, now(), now(), now())",
    [ledgerId, userId]
  );
  await pool.query(
    "INSERT INTO books (ledger_id, name, sort_order, created_at, updated_at) VALUES ($1, '旧账', 1, now(), now())",
    [ledgerId]
  );
  await pool.query(
    `INSERT INTO stored_files (id, ledger_id, storage_key, content_type, byte_size, created_at, finalized_at)
     VALUES ($1, $2, $3, 'image/jpeg', 10, now(), now())`,
    [fileId, ledgerId, key]
  );
  return { userId, ledgerId, key };
}

describe("0056 retired column preparation", () => {
  it("removes soft-deleted accounts and ledgers and queues their stray objects", async () => {
    const live = await createTestUserWithLedger(getTestDb());
    const retired = await seedRetiredAccount();

    await replayMigration(async (client) => {
      const ledgers = await client.query<{ id: string }>("SELECT id FROM ledgers ORDER BY id");
      expect(ledgers.rows.map((row) => row.id)).toEqual([live.ledgerId]);
      const users = await client.query<{ id: string }>("SELECT id FROM users");
      expect(users.rows.map((row) => row.id)).toEqual([live.userId]);
      const files = await client.query("SELECT 1 FROM stored_files WHERE ledger_id = $1", [
        retired.ledgerId,
      ]);
      expect(files.rowCount).toBe(0);
      const cleanup = await client.query<{ storage_key: string }>(
        "SELECT storage_key FROM object_cleanup_jobs"
      );
      expect(cleanup.rows.map((row) => row.storage_key)).toEqual([retired.key]);
    });
  });

  it("refuses to cascade away records that sit in a soft-deleted ledger", async () => {
    const live = await createTestUserWithLedger(getTestDb());
    await createTestSourceDocument(getTestDb(), live.ledgerId);
    await getTestPool().query("UPDATE ledgers SET deleted_at = now() WHERE id = $1", [
      live.ledgerId,
    ]);

    await expect(replayMigration(async () => {})).rejects.toThrow(
      /0056 found 1 source document\(s\) in soft-deleted ledgers/
    );
    const documents = await getTestPool().query("SELECT 1 FROM source_documents");
    expect(documents.rowCount).toBe(1);
  });

  it("rewrites legacy processing failure codes and keeps parser diagnostics", async () => {
    const { ledgerId } = await createTestUserWithLedger(getTestDb());
    const codes = new Map<string, [string, string]>([
      ["processing_error", ["RATE_LIMITED", "ai_provider_unavailable"]],
      ["processing_error_2", ["NOT_FOUND", "processing_unavailable"]],
      ["processing_error_3", ["database_unavailable", "processing_unavailable"]],
      ["processing_error_4", ["storage_failure", "storage_failure"]],
      ["invalid_input", ["entry_validation_failed", "entry_validation_failed"]],
    ]);
    const documentIds = new Map<string, string>();
    for (const [label, [stored]] of codes) {
      const documentId = await createTestSourceDocument(getTestDb(), ledgerId, {
        status: "failed",
      });
      documentIds.set(label, documentId);
      await getTestPool().query(
        `UPDATE source_document_revisions
            SET failure_kind = $2::revision_failure_kind, failure_code = $3
          WHERE source_document_id = $1`,
        [documentId, label.startsWith("invalid") ? "invalid_input" : "processing_error", stored]
      );
    }

    await replayMigration(async (client) => {
      for (const [label, [, expected]] of codes) {
        const row = await client.query<{ failure_code: string }>(
          "SELECT failure_code FROM source_document_revisions WHERE source_document_id = $1",
          [documentIds.get(label)]
        );
        expect(row.rows[0]?.failure_code, label).toBe(expected);
      }
    });
  });
});
