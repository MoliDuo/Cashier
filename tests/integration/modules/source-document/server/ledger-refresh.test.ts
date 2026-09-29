import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getStreamRefresh } from "@/modules/source-document/server/stream-refresh";
import { ledgers, extractionAttempts, sourceDocuments } from "@/persistence";
import { createTestSourceDocument, createTestUserWithLedger } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

describe("ledger refresh", () => {
  beforeEach(async () => {
    await createTestUserWithLedger(getTestDb(), undefined, undefined, crypto.randomUUID());
  });

  const refresh = (afterVersion: string) => getStreamRefresh({ afterVersion });

  async function version(): Promise<bigint> {
    const state = await getTestDb().query.ledgerSyncState.findFirst();
    return state?.version ?? BigInt(0);
  }

  it("returns no change at the current version", async () => {
    const currentVersion = await version();
    await expect(refresh(currentVersion.toString())).resolves.toEqual({
      version: currentVersion.toString(),
      changed: false,
      hasTransitionalWork: false,
      invalidations: { categories: false, settings: false, stats: false },
    });
  });

  it("summarizes continuous document and settings changes", async () => {
    await createTestSourceDocument(getTestDb(), { title: "Refresh receipt" });
    const afterDocument = await version();
    await getTestDb().update(ledgers).set({ aiLanguage: "en" });

    expect(await refresh(afterDocument.toString())).toEqual({
      version: (await version()).toString(),
      changed: true,
      hasTransitionalWork: false,
      invalidations: { categories: false, settings: true, stats: true },
    });
  });

  it("uses resource watermarks even for a client that has never refreshed", async () => {
    await createTestSourceDocument(getTestDb());
    await getTestDb().update(ledgers).set({ aiLanguage: "en" });
    expect(await refresh("0")).toMatchObject({
      changed: true,
      invalidations: { categories: false, settings: true, stats: true },
    });
  });

  it("coalesces a transaction and rolls back its resource watermarks", async () => {
    const before = await version();
    await getTestDb().transaction(async (tx) => {
      await tx.update(ledgers).set({ aiLanguage: "en" });
      await tx.update(ledgers).set({ aiLanguage: "zh-CN" });
    });
    expect(await version()).toBe(before + BigInt(1));
    const committed = await refresh(before.toString());
    await expect(
      getTestDb().transaction(async (tx) => {
        await tx.update(ledgers).set({ mainCurrency: "USD" });
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");
    expect(await refresh(before.toString())).toEqual(committed);
  });

  it("invalidates everything after a main-currency reset", async () => {
    const before = await version();
    await getTestDb().update(ledgers).set({ mainCurrency: "USD" });

    expect(await refresh(before.toString())).toMatchObject({
      changed: true,
      invalidations: { categories: true, settings: true, stats: true },
    });
  });

  it.each(["invalid", "9223372036854775808"])(
    "invalidates everything for invalid version %s",
    async (afterVersion) => {
      expect(await refresh(afterVersion)).toMatchObject({
        changed: true,
        invalidations: { categories: true, settings: true, stats: true },
      });
    }
  );

  it("invalidates everything for a future version", async () => {
    const current = await version();
    expect(await refresh((current + BigInt(1)).toString())).toMatchObject({
      version: current.toString(),
      changed: true,
      invalidations: { categories: true, settings: true, stats: true },
    });
  });

  it("reports processing work until the document reaches a terminal state", async () => {
    const documentId = await createTestSourceDocument(getTestDb(), {
      status: "processing",
    });
    const processing = await refresh("0");
    expect(processing.hasTransitionalWork).toBe(true);

    const document = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, documentId),
      columns: { latestAttemptId: true },
    });
    const attemptId = document?.latestAttemptId;
    if (attemptId == null) throw new Error("Expected processing attempt");
    await getTestDb()
      .update(extractionAttempts)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(extractionAttempts.id, attemptId));
    expect((await refresh(processing.version)).hasTransitionalWork).toBe(false);
  });
});
