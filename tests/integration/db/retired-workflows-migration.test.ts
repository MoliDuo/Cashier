import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { getTestPool } from "../../setup";

const migration = readFileSync(
  "src/persistence/postgres-migrations/0052_simplify_retired_workflows.sql",
  "utf8"
);

async function withLegacySchema(body: (client: PoolClient) => Promise<void>) {
  const client = await getTestPool().connect();
  const schema = `retired_${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`);
    // Only the pre-migration columns and constraints touched by 0052.
    await client.query(`
      CREATE TYPE retry_classification AS ENUM ('permanent', 'retryable', 'invalid');
      CREATE TYPE processing_attempt_status AS ENUM ('queued', 'processing', 'completed', 'failed', 'cancelled', 'invalid');
      CREATE TYPE processing_outbox_status AS ENUM ('pending', 'claimed', 'completed', 'failed', 'cancelled');
      CREATE TABLE category_reclassification_jobs (
        id integer PRIMARY KEY, format_version integer, status text, updated_at timestamptz,
        ledger_entry_ids uuid[], cursor integer, attempts integer, claim_token uuid,
        claim_expires_at timestamptz, next_attempt_at timestamptz,
        CONSTRAINT ck_category_reclassification_jobs_cursor CHECK (cursor >= 0)
      );
      CREATE INDEX idx_category_reclassification_jobs_due ON category_reclassification_jobs(next_attempt_at);
      CREATE TABLE source_document_revisions (id uuid PRIMARY KEY, ledger_id uuid, source_document_id uuid);
      CREATE TABLE processing_attempts (
        ledger_id uuid, revision_id uuid, attempt_number integer, status processing_attempt_status,
        retry_classification retry_classification, diagnostic_code text, correlation_id text,
        started_at timestamptz, completed_at timestamptz, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE processing_outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ledger_id uuid, revision_id uuid,
        source_document_id uuid, attempt_number integer, status processing_outbox_status,
        requested_at timestamptz, available_at timestamptz, next_available_at timestamptz,
        created_at timestamptz, completed_at timestamptz, claim_token uuid, claim_expires_at timestamptz
      );
      CREATE TABLE ledger_entries (source_document_revision_id uuid, position integer, deleted_at timestamptz);
      CREATE UNIQUE INDEX uq_ledger_entries_revision_position ON ledger_entries(source_document_revision_id, position);
    `);
    await body(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function applyMigration(client: PoolClient) {
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim() !== "") await client.query(statement);
  }
}

describe("0052 retired workflows migration", () => {
  it("preserves diagnostics, leases and orphan terminal results while retiring expired V1 jobs", async () => {
    await withLegacySchema(async (client) => {
      const ledgerId = crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      const documentId = crypto.randomUUID();
      const claimToken = crypto.randomUUID();
      await client.query("INSERT INTO source_document_revisions VALUES ($1, $2, $3)", [
        revisionId,
        ledgerId,
        documentId,
      ]);
      await client.query(
        `INSERT INTO processing_attempts
        (ledger_id, revision_id, attempt_number, status, retry_classification, diagnostic_code, correlation_id, started_at, completed_at)
        VALUES ($1, $2, 1, 'processing', 'retryable', 'provider_busy', 'request-1', '2026-01-01', NULL),
               ($1, $2, 2, 'invalid', 'invalid', 'unreadable', 'request-2', '2026-01-02', '2026-01-03')`,
        [ledgerId, revisionId]
      );
      await client.query(
        `INSERT INTO processing_outbox
        (ledger_id, revision_id, source_document_id, attempt_number, status, claim_token, claim_expires_at)
        VALUES ($1, $2, $3, 1, 'claimed', $4, '2026-01-04')`,
        [ledgerId, revisionId, documentId, claimToken]
      );
      await client.query(`INSERT INTO category_reclassification_jobs (id, format_version, status, updated_at)
        VALUES (1, 1, 'succeeded', now() - interval '8 days'), (2, 2, 'running', now())`);

      await applyMigration(client);

      const jobs = await client.query("SELECT * FROM processing_outbox ORDER BY attempt_number");
      expect(jobs.rows).toHaveLength(2);
      expect(jobs.rows[0]).toMatchObject({
        status: "claimed",
        claim_token: claimToken,
        diagnostic_code: "provider_busy",
        correlation_id: "request-1",
        started_at: new Date("2026-01-01Z"),
        claim_expires_at: new Date("2026-01-04Z"),
      });
      expect(jobs.rows[1]).toMatchObject({
        status: "failed",
        source_document_id: documentId,
        retry_classification: "invalid",
        diagnostic_code: "unreadable",
        correlation_id: "request-2",
        completed_at: new Date("2026-01-03Z"),
      });
      expect((await client.query("SELECT id FROM category_reclassification_jobs")).rows).toEqual([
        { id: 2 },
      ]);
      expect(
        (await client.query("SELECT to_regclass('processing_attempts') AS relation")).rows[0]
          .relation
      ).toBeNull();
      // A removed entry no longer reserves the live entry's position.
      await client.query("INSERT INTO ledger_entries VALUES ($1, 0, now()), ($1, 0, NULL)", [
        revisionId,
      ]);
    });
  });

  it.each(["recent-terminal", "active-v1", "orphan-active"])(
    "blocks %s and rolls back without losing legacy data",
    async (scenario) => {
      await withLegacySchema(async (client) => {
        if (scenario === "orphan-active") {
          await client.query(
            "INSERT INTO processing_attempts (ledger_id, revision_id, attempt_number, status) VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'processing')"
          );
        } else {
          await client.query(
            `INSERT INTO category_reclassification_jobs (id, format_version, status, updated_at)
          VALUES (1, 1, $1, now() - $2::interval)`,
            [
              scenario === "active-v1" ? "running" : "succeeded",
              scenario === "active-v1" ? "8 days" : "1 day",
            ]
          );
        }
        await client.query("SAVEPOINT before_migration");
        await expect(applyMigration(client)).rejects.toThrow(
          scenario === "orphan-active" ? "require repair" : "within retention"
        );
        await client.query("ROLLBACK TO SAVEPOINT before_migration");
        const table =
          scenario === "orphan-active" ? "processing_attempts" : "category_reclassification_jobs";
        expect(
          (await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count
        ).toBe(1);
      });
    }
  );
});
