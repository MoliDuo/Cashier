import { createHash } from "node:crypto";
import pg, { type PoolClient } from "pg";
import { z } from "zod";

const { Pool } = pg;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const expected = args.find((arg) => arg.startsWith("--expect="))?.slice("--expect=".length);
if (
  args.some((arg) => arg !== "--apply" && !arg.startsWith("--expect=")) ||
  (apply && !/^[a-f0-9]{64}$/.test(expected ?? "")) ||
  (!apply && expected != null) ||
  args.filter((arg) => arg.startsWith("--expect=")).length > 1
)
  throw new Error(
    "Preview takes no options; apply requires --apply --expect=<preview fingerprint>"
  );

const config = z
  .object({
    owner: z.string().uuid(),
    partner: z.string().uuid(),
    ledger: z.string().uuid(),
    url: z.string().min(1),
  })
  .refine((value) => value.owner !== value.partner)
  .parse({
    owner: process.env.COUPLE_OWNER_USER_ID,
    partner: process.env.COUPLE_PARTNER_USER_ID,
    ledger: process.env.COUPLE_LEDGER_ID,
    url: process.env.DATABASE_URL,
  });

// Keep this list in sync with the reviewed tables in migrate-couple-ledger.ts.
const ledgerTables = [
  "entry_categories",
  "source_documents",
  "source_document_revisions",
  "stored_files",
  "revision_files",
  "processing_attempts",
  "processing_outbox",
  "upload_sessions",
  "upload_session_files",
  "category_reclassification_jobs",
  "category_assignment_selection_chunks",
  "category_reclassification_job_documents",
  "category_reclassification_job_entries",
  "ledger_entries",
  "service_credentials",
  "exchange_rate_recalculation_jobs",
  "ledger_sync_state",
  "ledger_change_batches",
] as const;
const deleteOrder = [
  "category_assignment_selection_chunks",
  "category_reclassification_job_entries",
  "category_reclassification_job_documents",
  "category_reclassification_jobs",
  "processing_outbox",
  "processing_attempts",
  "upload_session_files",
  "revision_files",
  "ledger_entries",
  "upload_sessions",
  "source_documents",
  "source_document_revisions",
  "stored_files",
  "entry_categories",
  "service_credentials",
  "exchange_rate_recalculation_jobs",
  "ledger_change_batches",
  "ledger_sync_state",
] as const satisfies readonly (typeof ledgerTables)[number][];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function inspect(client: PoolClient) {
  const people = await client.query<{
    id: string;
    email: string;
    deleted_at: Date | null;
    registration_completed_at: Date | null;
  }>("SELECT id, email, deleted_at, registration_completed_at FROM users ORDER BY id");
  const owner = people.rows.find((row) => row.id === config.owner);
  const partner = people.rows.find((row) => row.id === config.partner);
  if (
    !owner ||
    !partner ||
    owner.deleted_at ||
    partner.deleted_at ||
    !owner.registration_completed_at ||
    !partner.registration_completed_at
  )
    throw new Error("Both configured members must be active");
  const ledgers = await client.query<{ id: string; user_id: string; deleted_at: Date | null }>(
    "SELECT id, user_id, deleted_at FROM ledgers ORDER BY id"
  );
  if (
    !ledgers.rows.some(
      (row) => row.id === config.ledger && row.user_id === config.owner && !row.deleted_at
    ) ||
    ledgers.rows.some((row) => row.user_id === config.partner && !row.deleted_at)
  )
    throw new Error("Complete the shared-ledger merge before pruning accounts");
  const tables = await client.query<{ table_name: string }>(
    "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'ledger_id' AND table_name <> 'ledgers'"
  );
  if (
    tables.rows.length !== ledgerTables.length ||
    tables.rows.some(
      (row) => !ledgerTables.includes(row.table_name as (typeof ledgerTables)[number])
    )
  )
    throw new Error("Ledger-associated table set differs from reviewed schema");
  const refs = await client.query<{ table_name: string }>(
    `SELECT DISTINCT child.relname AS table_name FROM pg_constraint fk
     JOIN pg_class child ON child.oid = fk.conrelid
     WHERE fk.contype = 'f' AND fk.connamespace = current_schema()::regnamespace
       AND fk.confrelid IN ('users'::regclass, 'ledgers'::regclass)`
  );
  const allowed = new Set<string>(["ledgers", "email_change_challenges", ...ledgerTables]);
  if (refs.rows.some((row) => !allowed.has(row.table_name)))
    throw new Error("Unknown account or ledger foreign key; review before deletion");

  const ids = people.rows
    .filter((row) => row.id !== config.owner && row.id !== config.partner)
    .map((row) => row.id);
  const otherLedgers = ledgers.rows.filter((row) => ids.includes(row.user_id)).map((row) => row.id);
  const counts: Record<string, number> = {};
  for (const table of ledgerTables) {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${quote(table)} WHERE ledger_id = ANY($1::uuid[])`,
      [otherLedgers]
    );
    counts[table] = Number(result.rows[0]!.count);
  }
  const principals = await client.query<{ id: string }>(
    "SELECT id FROM service_credentials WHERE ledger_id = ANY($1::uuid[]) ORDER BY id",
    [otherLedgers]
  );
  const credentials = principals.rows.map((row) => row.id);
  const idempotency = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM idempotency_records
     WHERE (principal_type = 'user' AND principal_id = ANY($1::uuid[]))
       OR (principal_type = 'credential' AND principal_id = ANY($2::uuid[]))`,
    [ids, credentials]
  );
  const emails = people.rows
    .filter((row) => ids.includes(row.id))
    .map((row) => row.email.toLowerCase());
  const otp = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM otp_tokens WHERE lower(email) = ANY($1::text[])",
    [emails]
  );
  const pending = await client.query<{ count: string }>(
    `SELECT (
      (SELECT count(*) FROM processing_attempts WHERE ledger_id = ANY($1::uuid[]) AND status IN ('queued','processing')) +
      (SELECT count(*) FROM processing_outbox WHERE ledger_id = ANY($1::uuid[]) AND status IN ('pending','claimed')) +
      (SELECT count(*) FROM upload_sessions WHERE ledger_id = ANY($1::uuid[]) AND status IN ('open','finalizing'))
    )::text AS count`,
    [otherLedgers]
  );
  const cleanupJobs = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM object_cleanup_jobs j
     JOIN upload_sessions s ON s.id = j.upload_session_id
     WHERE s.ledger_id = ANY($1::uuid[])`,
    [otherLedgers]
  );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        kept: [config.owner, config.partner, config.ledger],
        ids,
        otherLedgers,
        counts,
        credentials,
        idempotency: idempotency.rows[0]!.count,
        otp: otp.rows[0]!.count,
      })
    )
    .digest("hex");
  return {
    ids,
    otherLedgers,
    credentials,
    emails,
    counts,
    fingerprint,
    idempotencyCount: Number(idempotency.rows[0]!.count),
    otpCount: Number(otp.rows[0]!.count),
    pendingJobs: Number(pending.rows[0]!.count),
    cleanupJobs: Number(cleanupJobs.rows[0]!.count),
  };
}

const pool = new Pool({ connectionString: config.url, max: 1 });
try {
  const client = await pool.connect();
  try {
    await client.query(apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      if (apply) {
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('cashier-couple-prune', 0))"
        );
        await client.query("LOCK TABLE users, ledgers IN SHARE ROW EXCLUSIVE MODE");
      }
      const state = await inspect(client);
      if (apply) {
        if (expected !== state.fingerprint) throw new Error("Target changed since preview");
        if (state.pendingJobs || state.cleanupJobs)
          throw new Error("Other accounts still have active or cleanup work");
        await client.query(
          `DELETE FROM idempotency_records WHERE
            (principal_type = 'user' AND principal_id = ANY($1::uuid[])) OR
            (principal_type = 'credential' AND principal_id = ANY($2::uuid[]))`,
          [state.ids, state.credentials]
        );
        await client.query("DELETE FROM otp_tokens WHERE lower(email) = ANY($1::text[])", [
          state.emails,
        ]);
        for (const table of deleteOrder)
          await client.query(`DELETE FROM ${quote(table)} WHERE ledger_id = ANY($1::uuid[])`, [
            state.otherLedgers,
          ]);
        const deletedLedgers = await client.query(
          "DELETE FROM ledgers WHERE id = ANY($1::uuid[])",
          [state.otherLedgers]
        );
        if (deletedLedgers.rowCount !== state.otherLedgers.length)
          throw new Error("Ledger count changed during cleanup");
        const deleted = await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
          state.ids,
        ]);
        if (deleted.rowCount !== state.ids.length)
          throw new Error("Account count changed during cleanup");
        const remaining = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM users WHERE id <> ALL($1::uuid[])",
          [[config.owner, config.partner]]
        );
        if (Number(remaining.rows[0]!.count) !== 0)
          throw new Error("Unreviewed accounts remain after cleanup");
        for (const table of ledgerTables) {
          const rows = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM ${quote(table)} WHERE ledger_id = ANY($1::uuid[])`,
            [state.otherLedgers]
          );
          if (Number(rows.rows[0]!.count)) throw new Error(`Account data remains: ${table}`);
        }
        await client.query("COMMIT");
      } else await client.query("ROLLBACK");
      console.log(
        JSON.stringify(
          {
            mode: apply ? "apply" : "preview",
            otherAccounts: state.ids.length,
            otherLedgers: state.otherLedgers.length,
            records: state.counts,
            idempotencyRecords: state.idempotencyCount,
            otpTokens: state.otpCount,
            pendingJobs: state.pendingJobs,
            cleanupJobs: state.cleanupJobs,
            targetFingerprint: state.fingerprint,
          },
          null,
          2
        )
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
