import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger } from "../../helpers/schema-setup";
import { objectCleanupJobs, uploadSessionFiles, uploadSessions } from "@/persistence";

const deleteObject = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/s3", () => ({
  getS3Storage: () => ({ delete: deleteObject }),
}));

import { runBoundedMaintenance } from "@/application/adapters/postgres/maintenance";
import {
  acknowledgeObjectCleanup,
  claimObjectCleanup,
  enqueueObjectCleanup,
} from "@/application/adapters/postgres/object-cleanup";

afterEach(() => vi.useRealTimers());

describe("persistent object cleanup maintenance", () => {
  it("keeps database state until object deletion succeeds and retries with backoff", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const sessionId = crypto.randomUUID();
    const targetId = crypto.randomUUID();
    const old = new Date("2026-01-01T00:00:00.000Z");
    await db.insert(uploadSessions).values({
      id: sessionId,
      ledgerId,
      finalizationTokenHash: "token-hash",
      status: "cancelled",
      expiresAt: old,
      createdAt: old,
    });
    await db.insert(uploadSessionFiles).values({
      ledgerId,
      uploadSessionId: sessionId,
      targetId,
      position: 0,
      expectedContentType: "image/png",
      expectedByteSize: 10,
    });
    deleteObject.mockResolvedValueOnce({ success: false, error: new Error("unavailable") });

    const firstRun = new Date();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(firstRun);
    await runBoundedMaintenance(firstRun);

    expect(
      await db.query.uploadSessions.findFirst({ where: eq(uploadSessions.id, sessionId) })
    ).toBeDefined();
    const queued = await db.query.objectCleanupJobs.findFirst({
      where: eq(objectCleanupJobs.uploadSessionId, sessionId),
    });
    expect(queued).toMatchObject({ attempts: 1, lastError: "Error" });

    deleteObject.mockResolvedValueOnce({ success: true });
    vi.setSystemTime(new Date(firstRun.getTime() + 60 * 60 * 1000));
    await runBoundedMaintenance();

    expect(
      await db.query.objectCleanupJobs.findFirst({
        where: eq(objectCleanupJobs.uploadSessionId, sessionId),
      })
    ).toBeUndefined();
    expect(
      await db.query.uploadSessions.findFirst({ where: eq(uploadSessions.id, sessionId) })
    ).toBeUndefined();
    expect(deleteObject).toHaveBeenCalledWith(`temporary/${ledgerId}/${sessionId}/${targetId}`);
  });

  it("claims disjoint bounded batches and fences expired or replaced tokens", async () => {
    const db = getTestDb();
    const now = new Date();
    await db.insert(objectCleanupJobs).values(
      Array.from({ length: 60 }, (_, index) => ({
        storageKey: `unreferenced/${index}`,
        nextAttemptAt: now,
      }))
    );
    const [first, second] = await Promise.all([claimObjectCleanup(now), claimObjectCleanup(now)]);
    expect(first).toHaveLength(25);
    expect(second).toHaveLength(25);
    expect(new Set([...first, ...second].map((job) => job.id)).size).toBe(50);
    const job = first[0]!;
    expect(job.claimExpiresAt!.getTime() - now.getTime()).toBe(300_000);
    const expired = new Date(now.getTime() + 300_000);
    await expect(acknowledgeObjectCleanup(job, null, expired)).resolves.toBe(false);
    await expect(acknowledgeObjectCleanup(job, "Failed", expired)).resolves.toBe(false);
    await db
      .update(objectCleanupJobs)
      .set({ claimToken: crypto.randomUUID() })
      .where(eq(objectCleanupJobs.id, job.id));
    await expect(acknowledgeObjectCleanup(job, null, now)).resolves.toBe(false);
    await expect(acknowledgeObjectCleanup(job, "Failed", now)).resolves.toBe(false);
    const reclaimed = await claimObjectCleanup(expired);
    expect(reclaimed).toHaveLength(25);
    expect(reclaimed.every((row) => row.claimToken !== job.claimToken)).toBe(true);
  });

  it("serializes sibling success acknowledgements and deletes their session", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const now = new Date();
    const [session] = await db
      .insert(uploadSessions)
      .values({
        ledgerId,
        finalizationTokenHash: "hash",
        expiresAt: now,
        status: "cancelled",
      })
      .returning();
    await enqueueObjectCleanup("temporary/first", session!.id);
    await enqueueObjectCleanup("temporary/second", session!.id);
    const jobs = await claimObjectCleanup(new Date(Date.now() + 1000));
    expect(jobs).toHaveLength(2);
    expect(await Promise.all(jobs.map((job) => acknowledgeObjectCleanup(job, null)))).toEqual([
      true,
      true,
    ]);
    expect(await db.select().from(objectCleanupJobs)).toHaveLength(0);
    expect(
      await db.query.uploadSessions.findFirst({ where: eq(uploadSessions.id, session!.id) })
    ).toBeUndefined();
  });

  it("honors the global cooldown and deletes at most four objects concurrently", async () => {
    const db = getTestDb();
    await db.insert(objectCleanupJobs).values(
      Array.from({ length: 30 }, (_, index) => ({
        storageKey: `temporary/${index}`,
        nextAttemptAt: new Date(0),
      }))
    );
    let concurrent = 0;
    let maximum = 0;
    deleteObject.mockImplementation(async () => {
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent--;
      return { success: true };
    });
    const now = new Date();
    await Promise.all([runBoundedMaintenance(now), runBoundedMaintenance(now)]);
    expect(maximum).toBe(4);
    expect(await db.select().from(objectCleanupJobs)).toHaveLength(5);
    await runBoundedMaintenance(new Date(now.getTime() + 59_999));
    expect(await db.select().from(objectCleanupJobs)).toHaveLength(5);
    await runBoundedMaintenance(new Date(now.getTime() + 60_000));
    expect(await db.select().from(objectCleanupJobs)).toHaveLength(0);
  });
});
