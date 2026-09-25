import { describe, expect, it } from "vitest";
import { mapLedgerEntryDto } from "@/modules/ledger/server/entry-reads/mappers";
import type { LedgerEntry } from "@/persistence";

describe("mapLedgerEntryDto", () => {
  it("requires the source document relation and keeps categories optional", () => {
    // Reads select the converted amount and rate beside the stored columns.
    const entry: LedgerEntry & { convertedAmount: string | null; exchangeRate: string | null } = {
      id: "entry-1",
      ledgerId: "ledger-1",
      categoryId: null,
      sourceDocumentId: "document-1",
      sourceDocumentRevisionId: null,
      position: 0,
      amount: "12.50",
      currency: "USD",
      itemName: "Coffee",
      description: null,
      convertedAmount: "12.50",
      exchangeRate: "1",
      createdAt: new Date("2026-03-19T12:00:00.000Z"),
      updatedAt: new Date("2026-03-19T12:00:00.000Z"),
      deletedAt: null,
    };

    expect(() => mapLedgerEntryDto(entry)).toThrow("Active entry has no matching source document");
    const sourceDocument = {
      id: "document-1",
      ledgerId: "ledger-1",
      version: 1,
      title: null,
      documentDate: null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      deletedAt: null,
    };
    const dto = mapLedgerEntryDto({ ...entry, sourceDocument });
    expect("category" in dto).toBe(false);
    expect(dto.sourceDocument.id).toBe("document-1");
    expect(() =>
      mapLedgerEntryDto({
        ...entry,
        sourceDocument: { ...sourceDocument, ledgerId: "other-ledger" },
      })
    ).toThrow("Active entry has no matching source document");
  });
});
