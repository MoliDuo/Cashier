import { describe, expect, it, vi } from "vitest";
import type { ObjectStore } from "@/lib/storage";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { storedFiles } from "@/persistence";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";

const objectStore = vi.hoisted(() => ({ current: undefined as ObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

import { runDailyMaintenance } from "@/server/maintenance/daily";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seed() {
  const db = getTestDb();
  await createTestUserWithLedger(db);
  const storage = new MemoryObjectStore();
  objectStore.current = storage;
  const now = Date.now();
  // Files stored before the ledger id was retired sit under `<ledger id>/stored/`.
  const legacyPrefix = crypto.randomUUID();
  const file = (name: string, createdAt: number, finalized: boolean) => ({
    id: crypto.randomUUID(),
    storageKey: `stored/${name}`,
    contentType: "image/webp",
    byteSize: 1,
    createdAt: new Date(createdAt),
    finalizedAt: finalized ? new Date(createdAt) : null,
  });
  const stalePending = file("stale-pending", now - DAY_MS - 60_000, false);
  const freshPending = file("fresh-pending", now - DAY_MS + 60_000, false);
  const oldReady = file("old-ready", now - 3 * DAY_MS, true);
  const unused = file("unused", now - 7 * DAY_MS - 60_000, true);
  const used = file("used", now - 30 * DAY_MS, true);
  // Older rows carry keys of other shapes; the row, not the shape, keeps the object.
  const legacy = {
    ...file("legacy", now - 3 * DAY_MS, true),
    storageKey: `${legacyPrefix}/stored/a/b.jpg`,
  };
  const rows = [stalePending, freshPending, oldReady, unused, used, legacy];
  await db.insert(storedFiles).values(rows);
  const objectAt = async (key: string, modifiedAt: number) => {
    await storage.upload(key, Buffer.from(key));
    storage.modifiedAt.set(key, new Date(modifiedAt));
  };
  for (const row of rows) await objectAt(row.storageKey, row.createdAt.getTime());
  await submitSourceDocument({
    bookId: await testBookId(db),
    input: { text: null, storedFileIds: [used.id], documentDate: null },
  });
  await objectAt("stored/orphan", now - DAY_MS - 60_000);
  await objectAt(`${legacyPrefix}/stored/orphan`, now - DAY_MS - 60_000);
  await objectAt("stored/young-orphan", now - DAY_MS + 60_000);
  await objectAt(`${legacyPrefix}/stored/young-orphan`, now - DAY_MS + 60_000);
  await objectAt(`temporary/${stalePending.id}`, now - DAY_MS - 60_000);
  await objectAt("temporary/abandoned", now - DAY_MS - 60_000);
  await objectAt("temporary/session/target", now - 2 * DAY_MS);
  await objectAt("temporary/in-flight", now - DAY_MS + 60_000);
  return {
    db,
    legacyPrefix,
    storage,
    objectAt,
    stalePending,
    freshPending,
    oldReady,
    used,
    legacy,
  };
}

describe("daily upload maintenance", () => {
  it("deletes stale pending files, unused files, and old objects nothing names", async () => {
    const { db, legacyPrefix, storage, freshPending, oldReady, used, legacy } = await seed();

    await expect(runDailyMaintenance()).resolves.toMatchObject({
      pending_files: "done",
      unused_files: "done",
      temporary_objects: "done",
      orphan_objects: "done",
    });

    const kept = [freshPending, oldReady, used, legacy];
    expect((await db.select().from(storedFiles)).map((row) => row.id).sort()).toEqual(
      kept.map((row) => row.id).sort()
    );
    expect([...storage.files.keys()].sort()).toEqual(
      [
        ...kept.map((row) => row.storageKey),
        "stored/young-orphan",
        `${legacyPrefix}/stored/young-orphan`,
        "temporary/in-flight",
      ].sort()
    );
  });

  it("sweeps orphans under both key layouts and leaves temporary objects alone", async () => {
    const { db, legacyPrefix, storage, objectAt, stalePending } = await seed();
    const stale = Date.now() - 2 * DAY_MS;
    await objectAt(`temporary/${crypto.randomUUID()}/stored/upload`, stale);
    const temporaryBefore = [...storage.files.keys()].filter(
      (key) => key.startsWith("temporary/") && key !== `temporary/${stalePending.id}`
    );
    // With the temporary sweep down, only the orphan sweep could reach these.
    const listObjectsPage = storage.listObjectsPage.bind(storage);
    vi.spyOn(storage, "listObjectsPage").mockImplementation(async (prefix) => {
      if (prefix === "temporary/") throw new Error("listing unavailable");
      return listObjectsPage(prefix);
    });

    await expect(runDailyMaintenance()).resolves.toMatchObject({
      temporary_objects: "failed",
      orphan_objects: "done",
    });

    const keys = [...storage.files.keys()];
    expect(keys).not.toContain("stored/orphan");
    expect(keys).not.toContain(`${legacyPrefix}/stored/orphan`);
    expect(keys).toEqual(
      expect.arrayContaining(["stored/young-orphan", `${legacyPrefix}/stored/young-orphan`])
    );
    expect(keys.filter((key) => key.startsWith("temporary/")).sort()).toEqual(
      temporaryBefore.sort()
    );
    expect(await db.select().from(storedFiles)).toHaveLength(4);
  });

  it("starts no cleanup once the deadline has passed", async () => {
    const { db, storage } = await seed();
    const objectsBefore = [...storage.files.keys()].sort();

    await expect(runDailyMaintenance({ deadlineAt: Date.now() - 1 })).resolves.toMatchObject({
      pending_files: "skipped",
      unused_files: "skipped",
      temporary_objects: "skipped",
      orphan_objects: "skipped",
    });

    expect(await db.select().from(storedFiles)).toHaveLength(6);
    expect([...storage.files.keys()].sort()).toEqual(objectsBefore);
  });
});
