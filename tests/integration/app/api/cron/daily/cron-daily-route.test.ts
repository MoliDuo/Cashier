import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { flushAfterCallbacks } from "tests/setup.common";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { createPendingRevision } from "tests/helpers/processing-revision";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { GET } from "@/app/api/cron/daily/route";

vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => new MemoryObjectStore() }));

const SECRET = "a-cron-secret-that-is-long-enough-000";

function cronRequest(authorization?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/daily", {
    headers: authorization == null ? {} : { authorization },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/daily", () => {
  it("refuses to run while CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(cronRequest(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
  });

  it.each([undefined, "Bearer wrong-secret", SECRET])(
    "rejects the authorization %s",
    async (authorization) => {
      vi.stubEnv("CRON_SECRET", SECRET);
      const response = await GET(cronRequest(authorization));
      expect(response.status).toBe(401);
    }
  );

  it("runs every maintenance step with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const db = getTestDb();
    await db.execute(sql`
      INSERT INTO rate_limit_buckets (bucket_key, count, window_start, created_at)
      VALUES ('stale-bucket', 1, now() - interval '3 days', now() - interval '3 days')
    `);

    const response = await GET(cronRequest(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      steps: {
        expired_records: "done",
        processing_recovery: "done",
        category_recovery: "done",
        exchange_rates: "done",
        pending_files: "done",
        unused_files: "done",
        temporary_objects: "done",
        orphan_objects: "done",
      },
    });
    const stale = await db.execute(
      sql`SELECT 1 FROM rate_limit_buckets WHERE bucket_key = 'stale-bucket'`
    );
    expect(stale.rows).toHaveLength(0);
  });

  it("schedules processing attempts whose run was lost, in every ledger", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const pending = await createPendingRevision({
      ledgerId,
      input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });

    await GET(cronRequest(`Bearer ${SECRET}`));
    await flushAfterCallbacks(10_000);

    // The scheduled run claimed the attempt; the test provider then fails it.
    const claimed = await db.execute<{ attempt_count: number }>(sql`
      SELECT attempt_count FROM source_document_revisions WHERE id = ${pending.revision.id}
    `);
    expect(Number(claimed.rows[0]!.attempt_count)).toBeGreaterThanOrEqual(1);
  });
});
