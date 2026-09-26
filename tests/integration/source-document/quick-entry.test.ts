import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { ZodError } from "zod";
import { getTestDb } from "../../setup";
import {
  books,
  entryCategories,
  ledgerEntries,
  ledgers,
  loginEmails,
  sourceDocumentRevisions,
  sourceDocuments,
  users,
} from "@/persistence";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { ensureTestLedgerBooks } from "../../helpers/schema-setup";
import { insertExchangeRates } from "../../helpers/exchange-rates";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "../../helpers/session";
import { createQuickEntryAction } from "@/modules/source-document/server-actions/quick-entry";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";
const TEST_RATE_DATE = "2026-02-04";

function mockSession(userId = TEST_USER_ID) {
  vi.mocked(getCurrentSession).mockResolvedValue(
    testSession(userId, { email: "test@example.com" })
  );
}

describe("createQuickEntryAction", () => {
  let ledgerId: string;
  let categoryId: string;

  beforeEach(async () => {
    mockSession();
    const db = getTestDb();

    // Clean up
    await db.delete(ledgerEntries);
    await db.delete(sourceDocuments);
    await db.delete(entryCategories);
    await db.delete(ledgers);

    // Create test ledger
    ledgerId = randomUUID();
    await db.insert(ledgers).values({
      id: ledgerId,
      mainCurrency: "CNY",
    });
    await ensureTestLedgerBooks(db, ledgerId);

    // Create test category
    categoryId = randomUUID();
    await db.insert(entryCategories).values({
      id: categoryId,
      ledgerId,
      name: "Test Category",
      sortOrder: 0,
    });

    await insertExchangeRates(TEST_RATE_DATE, { CNY: 7.5, USD: 1.1 });
  });

  it("should create quick entry with valid data", async () => {
    const result = await createQuickEntryAction({
      categoryId,
      amount: "100.5",
      currency: "CNY",
      itemName: "Test Item",
      description: "Test description",
      entryDate: "2024-01-15",
    });

    expect(result.status).toBe("completed");
    expect(result.sourceDocumentId).toBeDefined();
    expect(result.ledgerEntryId).toBeDefined();

    // Verify source document was created
    const db = getTestDb();
    const sourceDoc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, result.sourceDocumentId),
    });
    expect(sourceDoc).toBeDefined();
    expect(sourceDoc?.title).toBe("Test Item");
    // A record typed in by hand has no input and no parse attempt.
    expect(sourceDoc).toMatchObject({ inputText: null, latestSubmissionRevisionId: null });
    await expect(
      db.query.sourceDocumentRevisions.findMany({
        where: eq(sourceDocumentRevisions.sourceDocumentId, result.sourceDocumentId),
      })
    ).resolves.toEqual([]);

    // Verify ledger entry was created
    const entry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, result.ledgerEntryId),
    });
    expect(entry).toBeDefined();
    expect(entry?.amount).toBe("100.500");
    expect(entry?.currency).toBe("CNY");
  });

  it("should use category name when itemName is not provided", async () => {
    const result = await createQuickEntryAction({
      categoryId,
      amount: "50",
    });

    const db = getTestDb();
    const entry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, result.ledgerEntryId),
    });
    expect(entry?.itemName).toBe("Test Category");
    const sourceDoc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, result.sourceDocumentId),
    });
    expect(sourceDoc?.title).toBe("Test Category");
  });

  it("should use default currency when not provided", async () => {
    const result = await createQuickEntryAction({
      categoryId,
      amount: "100",
    });

    const db = getTestDb();
    const entry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, result.ledgerEntryId),
    });
    expect(entry?.currency).toBe("CNY");
  });

  it("should use provided currency and read it converted at the stored day's rate", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network disabled in test"));

    try {
      const result = await createQuickEntryAction({
        categoryId,
        amount: "100",
        currency: "USD",
        entryDate: TEST_RATE_DATE,
      });

      const db = getTestDb();
      const entry = await db.query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.id, result.ledgerEntryId),
      });
      expect(entry?.currency).toBe("USD");
      const page = await listStreamPage(ledgerId, { limit: 10 });
      expect(page.items[0]?.ledgerEntries?.[0]).toMatchObject({
        amount: "100.000",
        currency: "USD",
        convertedAmount: "681.82",
        exchangeRate: "6.818181818182",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("saves the entry when the rate provider is down and reads it unconverted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("provider down"));

    try {
      const result = await createQuickEntryAction({
        categoryId,
        amount: "100",
        currency: "USD",
        entryDate: "2026-02-10",
      });

      expect(result.status).toBe("completed");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const page = await listStreamPage(ledgerId, { limit: 10 });
      expect(page.items[0]?.ledgerEntries?.[0]).toMatchObject({
        currency: "USD",
        convertedAmount: null,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("saves a currency the provider never publishes and reads it unconverted", async () => {
    const result = await createQuickEntryAction({
      categoryId,
      amount: "12.345",
      currency: "BHD",
      entryDate: TEST_RATE_DATE,
    });

    const page = await listStreamPage(ledgerId, { limit: 10 });
    expect(page.items.find((item) => item.id === result.sourceDocumentId)).toMatchObject({
      ledgerEntries: [{ amount: "12.345", currency: "BHD", convertedAmount: null }],
    });
  });

  it("should use current date when entryDate not provided", async () => {
    const result = await createQuickEntryAction({
      categoryId,
      amount: "100",
    });

    const db = getTestDb();
    const sourceDoc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, result.sourceDocumentId),
    });
    expect(sourceDoc?.documentDate).toBeDefined();
  });

  it("should throw error for unauthorized ledger", async () => {
    const otherUserId = randomUUID();
    const otherLedgerId = randomUUID();

    const db = getTestDb();
    // Create other user first
    await db.insert(users).values({
      id: otherUserId,
    });

    await db.insert(loginEmails).values({
      userId: otherUserId,
      email: "other@example.com",
      emailVerified: new Date(),
    });

    await db.insert(ledgers).values({
      id: otherLedgerId,
    });

    await expect(
      createQuickEntryAction({
        categoryId,
        amount: "100",
      })
    ).rejects.toThrow("Ledger not found");
  });

  it("should reject negative amount", async () => {
    await expect(
      createQuickEntryAction({
        categoryId,
        amount: "-100",
      })
    ).rejects.toThrow(ZodError);
  });

  it("should reject zero amount", async () => {
    await expect(
      createQuickEntryAction({
        categoryId,
        amount: "0",
      })
    ).rejects.toThrow(ZodError);
  });

  it("should create entry with null description", async () => {
    const result = await createQuickEntryAction({
      categoryId,
      amount: "100",
      description: null,
    });

    expect(result.status).toBe("completed");

    const db = getTestDb();
    const entry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, result.ledgerEntryId),
    });
    expect(entry?.description).toBeNull();
  });

  describe("the day an undated entry is filed under", () => {
    // 20:00 UTC on 20 March is already the 21st in Shanghai but still the 20th in Paris.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-03-20T20:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function filedDate(input: Parameters<typeof createQuickEntryAction>[0]) {
      const result = await createQuickEntryAction(input);
      const document = await getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, result.sourceDocumentId),
      });
      return document?.documentDate;
    }

    it("uses the member's own zone when the book has none", async () => {
      await expect(
        filedDate({ categoryId, amount: "100", timezone: "Asia/Shanghai" })
      ).resolves.toBe("2026-03-21");
      await expect(
        filedDate({ categoryId, amount: "100", timezone: "Europe/Paris" })
      ).resolves.toBe("2026-03-20");
    });

    it("lets the book's zone win over the member's", async () => {
      const [book] = await getTestDb()
        .insert(books)
        .values({ ledgerId, name: "Travel", sortOrder: 2, timeZone: "Asia/Shanghai" })
        .returning({ id: books.id });

      await expect(
        filedDate({ categoryId, amount: "100", bookId: book!.id, timezone: "Europe/Paris" })
      ).resolves.toBe("2026-03-21");
    });
  });
});
