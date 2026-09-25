import { describe, expect, it } from "vitest";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";
import {
  getStreamEffectiveDate,
  matchesStreamDocument,
  projectStreamDocument,
} from "@/modules/source-document/stream-filter-policy";

function makeItem(overrides: Partial<SourceDocumentListItemDto> = {}): SourceDocumentListItemDto {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    ledgerId: "00000000-0000-4000-8000-000000000002",
    version: 1,
    title: "Coffee receipt",
    text: null,
    processingStatus: "completed",
    failureKind: null,
    failureMessage: null,
    documentDate: "2026-08-05",
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    hasImages: false,
    supportedActions: [],
    canEdit: false,
    errorCode: null,
    ledgerEntries: [],
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<NonNullable<SourceDocumentListItemDto["ledgerEntries"]>[number]> = {}
) {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    ledgerId: "00000000-0000-4000-8000-000000000002",
    categoryId: null,
    sourceDocumentId: "00000000-0000-4000-8000-000000000001",
    amount: "50.00",
    currency: "USD",
    itemName: "Latte",
    description: "Morning coffee",
    convertedAmount: "50.00",
    exchangeRate: "1.000000",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    category: null,
    ...overrides,
  };
}

describe("stream filter policy", () => {
  it("matches search only against entry name and description", () => {
    const item = makeItem({
      title: "Coffee",
      ledgerEntries: [makeEntry({ itemName: "Tea", description: "Afternoon drink" })],
    });

    expect(matchesStreamDocument(item, { search: "coffee" })).toBe(false);
    expect(matchesStreamDocument(item, { search: "afternoon" })).toBe(true);
  });

  it("requires one entry to satisfy all amount bounds", () => {
    const item = makeItem({
      ledgerEntries: [
        makeEntry({
          id: "00000000-0000-4000-8000-000000000004",
          amount: "5.00",
          convertedAmount: "5.00",
        }),
        makeEntry({
          id: "00000000-0000-4000-8000-000000000005",
          amount: "100.00",
          convertedAmount: "100.00",
        }),
      ],
    });

    expect(matchesStreamDocument(item, { minAmount: "10", maxAmount: "90" })).toBe(false);
  });

  it("excludes empty-entry documents from amount and search windows", () => {
    const item = makeItem({ ledgerEntries: [] });

    expect(matchesStreamDocument(item, { minAmount: "1" })).toBe(false);
    expect(matchesStreamDocument(item, { search: "latte" })).toBe(false);
  });

  it("does not match amount windows with unconverted entries", () => {
    const item = makeItem({
      ledgerEntries: [makeEntry({ amount: "1.00", convertedAmount: null })],
    });

    expect(matchesStreamDocument(item, { minAmount: "1" })).toBe(false);
  });

  it("uses entryDate and then the UTC created-at date as the effective date", () => {
    expect(getStreamEffectiveDate(makeItem({ documentDate: "2026-08-01" }))).toBe("2026-08-01");
    expect(
      getStreamEffectiveDate({
        documentDate: null,
        createdAt: "2026-08-06T23:00:00.000Z",
      })
    ).toBe("2026-08-06");
  });

  it("projects only matching entries without changing canonical input", () => {
    const item = makeItem({
      ledgerEntries: [
        makeEntry({ itemName: "Latte" }),
        makeEntry({ id: "00000000-0000-4000-8000-000000000006", itemName: "Cake" }),
      ],
    });

    const projected = projectStreamDocument(item, { search: "latte" });

    expect(projected.ledgerEntries).toHaveLength(1);
    expect(projected.ledgerEntries?.[0]?.itemName).toBe("Latte");
    expect(item.ledgerEntries).toHaveLength(2);
  });
});
