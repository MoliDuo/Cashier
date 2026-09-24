import { describe, expect, it } from "vitest";
import { deriveSourceDocumentCapabilities } from "@/modules/source-document/domain/source-document-state";

describe("source document capabilities", () => {
  it("blocks manual writes while the latest submission is processing", () => {
    expect(
      deriveSourceDocumentCapabilities({
        activeRevisionId: "active-1",
        latestSubmissionStatus: "processing",
        hasSubmissionInput: true,
      })
    ).toMatchObject({ canEdit: false });
  });

  it("allows editing the retained result after processing fails", () => {
    expect(
      deriveSourceDocumentCapabilities({
        activeRevisionId: "active-1",
        latestSubmissionStatus: "failed",
        hasSubmissionInput: true,
      })
    ).toMatchObject({
      canEdit: true,
      supportedActions: expect.arrayContaining(["retry", "edit_retry", "split_entries"]),
    });
  });

  it("does not offer retry for a purely manual document without submitted input", () => {
    expect(
      deriveSourceDocumentCapabilities({
        activeRevisionId: "active-1",
        latestSubmissionStatus: null,
        hasSubmissionInput: false,
      }).supportedActions
    ).not.toContain("retry");
  });
});
