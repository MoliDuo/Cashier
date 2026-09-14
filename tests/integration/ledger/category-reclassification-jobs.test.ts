import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { categoryReclassificationJobs, ledgers } from "@/persistence";
import { postgresCategoryReclassificationJobAdapter } from "@/application/adapters/postgres/category-reclassification-jobs";
import { getTestDb } from "../../setup";
import { createLedgerData } from "../../helpers/factories";
import { createTestUser } from "../../helpers/schema-setup";

// Enqueued jobs become due at the wall-clock time of the insert, so the clock
// these tests drive has to sit after it rather than at a fixed past date.
const NOW = new Date("2030-01-01T00:00:00.000Z");
const LATER = new Date("2030-01-01T01:00:00.000Z");

function ids(count: number): string[] {
  return Array.from({ length: count }, () => crypto.randomUUID());
}

async function seedLedger() {
  const db = getTestDb();
  const ledger = createLedgerData();
  await db.insert(ledgers).values(ledger);
  return ledger;
}

async function enqueue(ledgerId: string) {
  return postgresCategoryReclassificationJobAdapter.enqueue({
    ledgerId,
    ledgerEntryIds: ids(3),
    candidateCategoryIds: ids(2),
  });
}

describe("category reclassification jobs", () => {
  it("claims a due job once, so a second concurrent claim finds nothing", async () => {
    const ledger = await seedLedger();
    const job = await enqueue(ledger.id);

    const [first, second] = await Promise.all([
      postgresCategoryReclassificationJobAdapter.claim({ now: NOW, leaseMs: 60_000 }),
      postgresCategoryReclassificationJobAdapter.claim({ now: NOW, leaseMs: 60_000 }),
    ]);

    expect(first.length + second.length).toBe(1);
    expect([...first, ...second][0]!.id).toBe(job.id);
  });

  it("lets an expired lease be claimed again", async () => {
    const ledger = await seedLedger();
    await enqueue(ledger.id);
    const [first] = await postgresCategoryReclassificationJobAdapter.claim({
      now: NOW,
      leaseMs: 60_000,
    });

    await expect(
      postgresCategoryReclassificationJobAdapter.claim({
        now: new Date(NOW.getTime() + 30_000),
        leaseMs: 60_000,
      })
    ).resolves.toHaveLength(0);

    const afterExpiry = await postgresCategoryReclassificationJobAdapter.claim({
      now: LATER,
      leaseMs: 60_000,
    });
    expect(afterExpiry).toHaveLength(1);
    expect(afterExpiry[0]!.claimToken).not.toBe(first!.claimToken);
  });

  it("refuses progress from a claim token that lost its lease", async () => {
    const ledger = await seedLedger();
    const job = await enqueue(ledger.id);
    const [claimed] = await postgresCategoryReclassificationJobAdapter.claim({
      now: NOW,
      leaseMs: 60_000,
    });
    // A second worker takes the expired lease over.
    await postgresCategoryReclassificationJobAdapter.claim({ now: LATER, leaseMs: 60_000 });

    const staleWrite = await postgresCategoryReclassificationJobAdapter.recordProgress({
      jobId: job.id,
      claimToken: claimed!.claimToken,
      cursor: 2,
      appliedCount: 2,
      confirmedCount: 0,
      now: LATER,
    });

    expect(staleWrite).toBe(false);
    await expect(
      postgresCategoryReclassificationJobAdapter.get({ ledgerId: ledger.id, jobId: job.id })
    ).resolves.toMatchObject({ cursor: 0, appliedCount: 0 });
  });

  it("rejects a second active run for the same ledger", async () => {
    const ledger = await seedLedger();
    await enqueue(ledger.id);

    await expect(enqueue(ledger.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows a new run once the previous one finished", async () => {
    const ledger = await seedLedger();
    const job = await enqueue(ledger.id);
    const [claimed] = await postgresCategoryReclassificationJobAdapter.claim({
      now: NOW,
      leaseMs: 60_000,
    });
    await postgresCategoryReclassificationJobAdapter.complete({
      jobId: job.id,
      claimToken: claimed!.claimToken,
      cursor: 3,
      appliedCount: 2,
      confirmedCount: 1,
      now: NOW,
    });

    await expect(enqueue(ledger.id)).resolves.toMatchObject({ status: "pending" });
  });

  it("keeps a completed run visible with its counts", async () => {
    const ledger = await seedLedger();
    const job = await enqueue(ledger.id);
    const [claimed] = await postgresCategoryReclassificationJobAdapter.claim({
      now: NOW,
      leaseMs: 60_000,
    });
    await postgresCategoryReclassificationJobAdapter.complete({
      jobId: job.id,
      claimToken: claimed!.claimToken,
      cursor: 3,
      appliedCount: 2,
      confirmedCount: 1,
      now: NOW,
    });

    await expect(
      postgresCategoryReclassificationJobAdapter.getLatest({ ledgerId: ledger.id })
    ).resolves.toMatchObject({
      status: "succeeded",
      appliedCount: 2,
      confirmedCount: 1,
      cursor: 3,
    });
  });

  it("gives up after three attempts and records why", async () => {
    const ledger = await seedLedger();
    const job = await enqueue(ledger.id);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const at = new Date(NOW.getTime() + attempt * 3_600_000);
      const [claimed] = await postgresCategoryReclassificationJobAdapter.claim({
        now: at,
        leaseMs: 60_000,
      });
      expect(claimed).toBeTruthy();
      const outcome = await postgresCategoryReclassificationJobAdapter.fail({
        jobId: job.id,
        claimToken: claimed!.claimToken,
        now: at,
        errorCode: "AI_JSON_REPAIR_FAILED",
      });
      expect(outcome).toBe(attempt < 3 ? "retry_scheduled" : "permanently_failed");
    }

    await expect(
      postgresCategoryReclassificationJobAdapter.get({ ledgerId: ledger.id, jobId: job.id })
    ).resolves.toMatchObject({
      status: "failed",
      attempts: 3,
      lastError: "AI_JSON_REPAIR_FAILED",
    });
  });

  it("scopes a claim to one ledger when asked", async () => {
    const secondUserId = crypto.randomUUID();
    await createTestUser(getTestDb(), undefined, secondUserId);
    const first = await seedLedger();
    const second = createLedgerData({ userId: secondUserId });
    await getTestDb().insert(ledgers).values(second);
    const firstJob = await enqueue(first.id);
    await enqueue(second.id);

    const claimed = await postgresCategoryReclassificationJobAdapter.claim({
      now: NOW,
      leaseMs: 60_000,
      ledgerId: second.id,
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).not.toBe(firstJob.id);
  });

  it("does not retain the old 100-entry or 8-candidate database bounds", async () => {
    const ledger = await seedLedger();

    const created = await postgresCategoryReclassificationJobAdapter.enqueue({
      ledgerId: ledger.id,
      ledgerEntryIds: ids(101),
      candidateCategoryIds: ids(13),
    });
    expect(created.ledgerEntryIds).toHaveLength(101);
    expect(created.candidateCategoryIds).toHaveLength(13);

    await expect(
      getTestDb()
        .select({ id: categoryReclassificationJobs.id })
        .from(categoryReclassificationJobs)
        .where(eq(categoryReclassificationJobs.ledgerId, ledger.id))
    ).resolves.toHaveLength(1);
  });
});
