import { describe, expect, it } from "vitest";
import { saveSourceDocumentChangesInputSchema } from "@/modules/source-document/contract-schemas";
import { toSaveSourceDocumentChangesInput } from "@/modules/source-document/detail-save-input";

const documentId = "00000000-0000-4000-8000-000000000001";
const entryA = "00000000-0000-4000-8000-00000000000a";
const entryB = "00000000-0000-4000-8000-00000000000b";

describe("toSaveSourceDocumentChangesInput", () => {
  it("builds a payload the save schema accepts when the date changed", () => {
    const input = toSaveSourceDocumentChangesInput(documentId, 3, {
      sourceDoc: { title: "Dinner", documentDate: "2026-09-20" },
      entries: { [entryB]: { amount: "12.5" }, [entryA]: { itemName: "Tea" } },
    });

    expect(saveSourceDocumentChangesInputSchema.parse(input)).toEqual({
      sourceDocumentId: documentId,
      expectedVersion: 3,
      sourceDocument: { title: "Dinner", documentDate: "2026-09-20" },
      entries: [
        { ledgerEntryId: entryA, data: { itemName: "Tea" } },
        { ledgerEntryId: entryB, data: { amount: "12.5" } },
      ],
    });
  });

  it("omits the document patch when only entries changed", () => {
    const input = toSaveSourceDocumentChangesInput(documentId, 1, {
      sourceDoc: {},
      entries: { [entryA]: { description: "note" } },
    });

    expect(input).not.toHaveProperty("sourceDocument");
    expect(saveSourceDocumentChangesInputSchema.safeParse(input).success).toBe(true);
  });
});
