import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { ObjectStore } from "@/lib/storage";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { storedFiles } from "@/persistence";

const objectStore = vi.hoisted(() => ({ current: undefined as ObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

import {
  findFilesToRelocate,
  findObjectsOutsideLayout,
  relocateStoredFile,
} from "@/server/stored-files/relocation";

async function seed() {
  const db = getTestDb();
  await createTestUserWithLedger(db);
  const storage = new MemoryObjectStore();
  objectStore.current = storage;
  const legacyPrefix = crypto.randomUUID();
  const file = (storageKey: (id: string) => string, finalized = true) => {
    const id = crypto.randomUUID();
    const bytes = Buffer.from(`bytes of ${id}`);
    return {
      id,
      storageKey: storageKey(id),
      contentType: "image/webp",
      byteSize: bytes.length,
      finalizedAt: finalized ? new Date() : null,
      bytes,
    };
  };
  const legacy = file((id) => `${legacyPrefix}/stored/${id}`);
  const oddShape = file(() => `${legacyPrefix}/stored/a/b.jpg`);
  const current = file((id) => `stored/${id}`);
  const pending = file((id) => `temporary/${id}`, false);
  const rows = [legacy, oddShape, current, pending];
  await db.insert(storedFiles).values(rows.map(({ bytes: _bytes, ...row }) => row));
  for (const row of rows) await storage.upload(row.storageKey, row.bytes);
  await storage.upload(`${legacyPrefix}/stored/orphan`, Buffer.from("orphan"));
  return { db, storage, legacyPrefix, legacy, oddShape, current, pending };
}

describe("stored file relocation", () => {
  it("moves ready files under older layouts to stored/<id> and deletes the old objects", async () => {
    const { db, storage, legacyPrefix, legacy, oddShape, current, pending } = await seed();

    const files = await findFilesToRelocate();
    expect(files.map((file) => file.id).sort()).toEqual([legacy.id, oddShape.id].sort());
    for (const file of files) await expect(relocateStoredFile(file)).resolves.toBe("moved");

    const keys = new Map(
      (await db.select().from(storedFiles)).map((row) => [row.id, row.storageKey])
    );
    expect(keys.get(legacy.id)).toBe(`stored/${legacy.id}`);
    expect(keys.get(oddShape.id)).toBe(`stored/${oddShape.id}`);
    expect(keys.get(current.id)).toBe(current.storageKey);
    expect(keys.get(pending.id)).toBe(pending.storageKey);
    expect(storage.files.get(`stored/${legacy.id}`)).toEqual(legacy.bytes);
    expect(storage.files.get(`stored/${oddShape.id}`)).toEqual(oddShape.bytes);
    expect(storage.files.has(legacy.storageKey)).toBe(false);
    expect(storage.files.has(oddShape.storageKey)).toBe(false);

    await expect(findFilesToRelocate()).resolves.toEqual([]);
    await expect(findObjectsOutsideLayout()).resolves.toEqual({
      count: 1,
      byteSize: "orphan".length,
      sample: [`${legacyPrefix}/stored/orphan`],
    });
  });

  it("leaves a row that changed meanwhile, and its old object, alone", async () => {
    const { db, storage, legacy } = await seed();
    const [file] = (await findFilesToRelocate()).filter((row) => row.id === legacy.id);
    await db.delete(storedFiles).where(eq(storedFiles.id, legacy.id));

    await expect(relocateStoredFile(file!)).resolves.toBe("row_changed");
    expect(storage.files.has(legacy.storageKey)).toBe(true);
  });

  it("keeps the move when deleting the old object fails", async () => {
    const { db, storage, legacy } = await seed();
    const [file] = (await findFilesToRelocate()).filter((row) => row.id === legacy.id);
    vi.spyOn(storage, "delete").mockResolvedValueOnce({ success: false });

    await expect(relocateStoredFile(file!)).resolves.toBe("moved_old_kept");
    const [row] = await db.select().from(storedFiles).where(eq(storedFiles.id, legacy.id));
    expect(row?.storageKey).toBe(`stored/${legacy.id}`);
    expect(storage.files.has(legacy.storageKey)).toBe(true);
  });

  it("refuses bytes that do not match the row and changes nothing", async () => {
    const { db, storage, legacy } = await seed();
    const [file] = (await findFilesToRelocate()).filter((row) => row.id === legacy.id);
    await storage.upload(legacy.storageKey, Buffer.from("truncated"));

    await expect(relocateStoredFile(file!)).rejects.toThrow(`Stored file ${legacy.id} has`);
    const [row] = await db.select().from(storedFiles).where(eq(storedFiles.id, legacy.id));
    expect(row?.storageKey).toBe(legacy.storageKey);
    expect(storage.files.has(`stored/${legacy.id}`)).toBe(false);
  });
});
