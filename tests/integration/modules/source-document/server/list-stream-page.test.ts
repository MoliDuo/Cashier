import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestSourceDocument, createTestLedger } from "tests/helpers/schema-setup";
import { ledgers } from "@/persistence";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";

const duringPageRead = vi.hoisted(() => ({ write: null as null | (() => Promise<unknown>) }));

// The page read itself is real; a test may slip a concurrent write in while it runs.
vi.mock("@/modules/source-document/server/reads/list", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/source-document/server/reads/list")>();
  return {
    ...actual,
    listTargetSourceDocuments: async (
      ...args: Parameters<typeof actual.listTargetSourceDocuments>
    ) => {
      const page = await actual.listTargetSourceDocuments(...args);
      await duringPageRead.write?.();
      return page;
    },
  };
});

describe("listStreamPage", () => {
  beforeEach(async () => {
    duringPageRead.write = null;
    const db = getTestDb();
    await db.delete(ledgers);
    await createTestLedger(db);
    await createTestSourceDocument(db, { status: "completed" });
  });

  it("asks the reader to restart when the ledger changes while the page is read", async () => {
    const before = await listStreamPage({ limit: 20 });
    expect(before).toMatchObject({ items: [expect.anything()] });
    expect(before.restartRequired).toBeUndefined();

    duringPageRead.write = () => createTestSourceDocument(getTestDb(), { status: "processing" });
    const torn = await listStreamPage({ limit: 20 });

    expect(torn).toEqual({
      items: [],
      nextCursor: null,
      generation: expect.any(String),
      hasTransitionalWork: true,
      restartRequired: true,
    });
    expect(BigInt(torn.generation)).toBeGreaterThan(BigInt(before.generation));
  });

  it("refuses a cursor from an older generation of the ledger", async () => {
    await createTestSourceDocument(getTestDb(), { status: "completed" });
    const first = await listStreamPage({ limit: 1 });
    expect(first.nextCursor).not.toBeNull();

    await createTestSourceDocument(getTestDb(), { status: "completed" });

    await expect(listStreamPage({ limit: 1, cursor: first.nextCursor })).resolves.toMatchObject({
      items: [],
      nextCursor: null,
      restartRequired: true,
    });
  });
});
