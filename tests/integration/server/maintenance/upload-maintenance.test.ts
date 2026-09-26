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
  const { ledgerId } = await createTestUserWithLedger(db);
  const storage = new MemoryObjectStore();
  objectStore.current = storage;
  const now = Date.now();
  const file = (name: string, createdAt: number, finalized: boolean) => ({
    id: crypto.randomUUID(),
    ledgerId,
    storageKey: `${ledgerId}/stored/${name}`,
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
    storageKey: `${ledgerId}/stored/a/b.jpg`,
  };
  const rows = [stalePending, freshPending, oldReady, unused, used, legacy];
  await db.insert(storedFiles).values(rows);
  const objectAt = async (key: string, modifiedAt: number) => {
    await storage.upload(key, Buffer.from(key));
    storage.modifiedAt.set(key, new Date(modifiedAt));
  };
  for (const row of rows) await objectAt(row.storageKey, row.createdAt.getTime());
  await submitSourceDocument({
    ledgerId,
    bookId: await testBookId(db, ledgerId),
    input: { text: null, storedFileIds: [used.id], documentDate: null },
  });
  await objectAt(`${ledgerId}/stored/orphan`, now - DAY_MS - 60_000);
  await objectAt(`${ledgerId}/stored/young-orphan`, now - DAY_MS + 60_000);
  await objectAt(`temporary/${ledgerId}/${stalePending.id}`, now - DAY_MS - 60_000);
  await objectAt(`temporary/${ledgerId}/abandoned`, now - DAY_MS - 60_000);
  await objectAt(`temporary/${ledgerId}/session/target`, now - 2 * DAY_MS);
  await objectAt(`temporary/${ledgerId}/in-flight`, now - DAY_MS + 60_000);
  return { db, ledgerId, storage, stalePending, freshPending, oldReady, used, legacy };
}

describe("daily upload maintenance", () => {
  it("deletes stale pending files, unused files, and old objects nothing names", async () => {
    const { db, ledgerId, storage, freshPending, oldReady, used, legacy } = await seed();

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
        `${ledgerId}/stored/young-orphan`,
        `temporary/${ledgerId}/in-flight`,
      ].sort()
    );
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
