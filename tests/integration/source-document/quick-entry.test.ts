import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZodError } from "zod";
import { getTestDb } from "../../setup";
import {
  currencyRates,
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

// Mock auth
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/auth";
import { createQuickEntryAction } from "@/modules/source-document/server-actions/quick-entry";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";
const TEST_RATE_DATE = "2026-02-04";

function mockSession(userId = TEST_USER_ID) {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
    user: { id: userId, email: "test@example.com" },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
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
    await db.delete(currencyRates);

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

    await db.insert(currencyRates).values({
      date: TEST_RATE_DATE,
      base: "EUR",
      rates: {
        CNY: 7.5,
        USD: 1.1,
      },
    });
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
    await expect(
      db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.id, sourceDoc!.activeRevisionId!),
      })
    ).resolves.toMatchObject({
      processingStatus: null,
      inputText: null,
    });

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

  it("should use provided currency", async () => {
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
      expect(entry?.convertedAmount).toBe("681.820");
      expect(entry?.exchangeRate).toBe("6.818181818182");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
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
});
