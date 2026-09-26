import { describe, expect, it } from "vitest";
import { applyDateOrganizationInputSchema } from "@/modules/source-document/contract-schemas";

const SOURCE_DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const SUGGESTION_ID = "22222222-2222-4222-8222-222222222222";
const ENTRY_ONE_ID = "33333333-3333-4333-8333-333333333333";
const ENTRY_TWO_ID = "44444444-4444-4444-8444-444444444444";

function validInput() {
  return {
    sourceDocumentId: SOURCE_DOCUMENT_ID,
    suggestionId: SUGGESTION_ID,
    groups: [
      { id: "retain", entryDate: null, ledgerEntryIds: [ENTRY_ONE_ID] },
      { id: "yesterday", entryDate: "2026-09-09", ledgerEntryIds: [ENTRY_TWO_ID] },
    ],
    appliedGroupIds: ["yesterday"],
  };
}

describe("applyDateOrganizationInputSchema", () => {
  it("accepts distinct date groups and an applied dated group", () => {
    expect(applyDateOrganizationInputSchema.parse(validInput())).toEqual(validInput());
  });

  it("rejects duplicate entries, targets, and applied groups", () => {
    const duplicateEntry = validInput();
    duplicateEntry.groups[1]!.ledgerEntryIds = [ENTRY_ONE_ID];
    expect(() => applyDateOrganizationInputSchema.parse(duplicateEntry)).toThrow();

    const duplicateTarget = validInput();
    duplicateTarget.groups.push({
      id: "same-date",
      entryDate: "2026-09-09",
      ledgerEntryIds: ["55555555-5555-4555-8555-555555555555"],
    });
    expect(() => applyDateOrganizationInputSchema.parse(duplicateTarget)).toThrow();

    expect(() =>
      applyDateOrganizationInputSchema.parse({
        ...validInput(),
        appliedGroupIds: ["yesterday", "yesterday"],
      })
    ).toThrow();
  });

  it("rejects applying the retain group", () => {
    expect(() =>
      applyDateOrganizationInputSchema.parse({ ...validInput(), appliedGroupIds: ["retain"] })
    ).toThrow();
  });
});
