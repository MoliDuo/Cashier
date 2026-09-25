import { describe, expect, it, vi } from "vitest";
import type { ObjectStore } from "@/lib/storage";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger } from "../../helpers/schema-setup";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { storedFiles } from "@/persistence";

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
  await db.insert(storedFiles).values([stalePending, freshPending, oldReady]);
  for (const row of [stalePending, freshPending, oldReady]) {
    await storage.upload(row.storageKey, Buffer.from(row.id));
  }
  const objectAt = async (key: string, modifiedAt: number) => {
    await storage.upload(key, Buffer.from(key));
    storage.modifiedAt.set(key, new Date(modifiedAt));
  };
  await objectAt(`temporary/${ledgerId}/${stalePending.id}`, now - DAY_MS - 60_000);
  await objectAt(`temporary/${ledgerId}/abandoned`, now - DAY_MS - 60_000);
  await objectAt(`temporary/${ledgerId}/session/target`, now - 2 * DAY_MS);
  await objectAt(`temporary/${ledgerId}/in-flight`, now - DAY_MS + 60_000);
  return { db, ledgerId, storage, stalePending, freshPending, oldReady };
}

describe("daily upload maintenance", () => {
  it("deletes files left pending for a day and temporary objects older than one", async () => {
    const { db, ledgerId, storage, freshPending, oldReady } = await seed();

    await expect(runDailyMaintenance()).resolves.toMatchObject({
      pending_files: "done",
      temporary_objects: "done",
    });

    expect((await db.select().from(storedFiles)).map((row) => row.id).sort()).toEqual(
      [freshPending.id, oldReady.id].sort()
    );
    expect([...storage.files.keys()].sort()).toEqual(
      [freshPending.storageKey, oldReady.storageKey, `temporary/${ledgerId}/in-flight`].sort()
    );
  });

  it("starts no cleanup once the deadline has passed", async () => {
    const { db, storage } = await seed();
    const objectsBefore = [...storage.files.keys()].sort();

    await expect(runDailyMaintenance({ deadlineAt: Date.now() - 1 })).resolves.toMatchObject({
      pending_files: "skipped",
      temporary_objects: "skipped",
    });

    expect(await db.select().from(storedFiles)).toHaveLength(3);
    expect([...storage.files.keys()].sort()).toEqual(objectsBefore);
  });
});
