import { describe, expect, it } from "vitest";
import {
  createSourceDocumentInputSchema,
  createSourceDocumentInputSchemaV1,
  retrySourceDocumentInputSchema,
  updateSourceDocumentInputSchema,
  batchUpdateSourceDocumentsInputSchema,
  saveSourceDocumentChangesInputSchema,
} from "@/modules/source-document/contract-schemas";
import { MAX_FILES } from "@/lib/storage/upload-policy";
import {
  ledgerStatsQuerySchema,
  listLedgerEntriesInputSchema,
} from "@/modules/ledger/contract-schemas";

describe("contract schema omission semantics", () => {
  it("omits undefined optional keys in source-document create/retry schemas", () => {
    const createParsed = createSourceDocumentInputSchema.parse({
      text: "Lunch 12.50",
      timezone: undefined,
    });
    const retryParsed = retrySourceDocumentInputSchema.parse({
      text: "Lunch 12.50",
      storedFileIds: [],
      documentDate: null,
      timezone: undefined,
    });

    expect(Object.prototype.hasOwnProperty.call(createParsed, "timezone")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(retryParsed, "timezone")).toBe(false);
  });

  it("keeps the API v1 Shortcut contract compact and normalizes ISO entry dates", () => {
    const parsed = createSourceDocumentInputSchemaV1.parse({
      images: [{ data: "AQ==\n", mimeType: "image/jpeg" }],
      entryDate: "2026-07-27T23:30:00+08:00",
    });
    expect(parsed.entryDate).toBe("2026-07-27");
    expect(parsed.images).toHaveLength(1);

    expect(() =>
      createSourceDocumentInputSchemaV1.parse({
        text: "removed from v1",
        images: [{ data: "AQ==", mimeType: "image/jpeg" }],
      })
    ).toThrow();
  });

  it("omits undefined optional keys in ledger list/stats schemas", () => {
    const listParsed = listLedgerEntriesInputSchema.parse({
      currency: undefined,
      minAmount: undefined,
      maxAmount: undefined,
      limit: "5",
    });
    const statsParsed = ledgerStatsQuerySchema.parse({
      categoryId: undefined,
    });

    expect(listParsed.limit).toBe(5);
    expect(Object.prototype.hasOwnProperty.call(listParsed, "currency")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(listParsed, "minAmount")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(listParsed, "maxAmount")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(statsParsed, "categoryId")).toBe(false);
  });

  it("preserves ledger minAmount and maxAmount query values as decimal strings", () => {
    const parsed = listLedgerEntriesInputSchema.parse({
      minAmount: "20",
      maxAmount: "100",
      limit: "5",
    });

    expect(parsed.limit).toBe(5);
    expect(parsed.minAmount).toBe("20");
    expect(parsed.maxAmount).toBe("100");
  });

  it("limits stored files and rejects legacy browser inline-image fields", () => {
    const uuid = () => crypto.randomUUID();

    expect(() =>
      createSourceDocumentInputSchema.parse({
        storedFileIds: Array.from({ length: MAX_FILES }, () => uuid()),
      })
    ).not.toThrow();

    expect(() =>
      createSourceDocumentInputSchema.parse({
        storedFileIds: Array.from({ length: MAX_FILES + 1 }, () => uuid()),
      })
    ).toThrow();

    expect(() =>
      createSourceDocumentInputSchema.parse({
        text: "receipt",
        images: [{ data: "dGVzdA==", mimeType: "image/jpeg" }],
      })
    ).toThrow();

    expect(() =>
      createSourceDocumentInputSchema.parse({
        text: "receipt",
        originalImages: [{ data: "dGVzdA==", mimeType: "image/jpeg" }],
      })
    ).toThrow();
  });

  it("rejects blank ledger minAmount and maxAmount query values", () => {
    expect(() =>
      listLedgerEntriesInputSchema.parse({
        minAmount: "",
        limit: "5",
      })
    ).toThrow();

    expect(() =>
      listLedgerEntriesInputSchema.parse({
        maxAmount: "",
        limit: "5",
      })
    ).toThrow();
  });

  it("rejects empty source-document patches and batch status mutations", () => {
    expect(updateSourceDocumentInputSchema.safeParse({}).success).toBe(false);
    expect(batchUpdateSourceDocumentsInputSchema.safeParse({}).success).toBe(false);
    expect(batchUpdateSourceDocumentsInputSchema.safeParse({ status: "completed" }).success).toBe(
      false
    );
  });

  it("limits atomic save changes to 100 entries", () => {
    const input = {
      sourceDocumentId: crypto.randomUUID(),
      expectedRevisionId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      entries: Array.from({ length: 101 }, () => ({
        ledgerEntryId: crypto.randomUUID(),
        data: { itemName: "Item" },
      })),
    };
    expect(saveSourceDocumentChangesInputSchema.safeParse(input).success).toBe(false);
  });
});
