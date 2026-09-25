import { describe, expect, it } from "vitest";
import { deriveSourceDocumentCapabilities } from "@/modules/source-document/domain/source-document-state";

describe("source document capabilities", () => {
  it("blocks manual writes while the latest submission is processing", () => {
    expect(
      deriveSourceDocumentCapabilities({
        latestSubmissionStatus: "processing",
        hasSubmissionInput: true,
      })
    ).toMatchObject({ canEdit: false });
  });

  it("allows editing the retained result after processing fails", () => {
    expect(
      deriveSourceDocumentCapabilities({
        latestSubmissionStatus: "failed",
        hasSubmissionInput: true,
      })
    ).toMatchObject({
      canEdit: true,
      supportedActions: expect.arrayContaining(["retry", "edit_retry", "split_entries"]),
    });
  });

  it("allows editing by hand a document whose first parse failed", () => {
    expect(
      deriveSourceDocumentCapabilities({
        latestSubmissionStatus: "failed",
        hasSubmissionInput: true,
      })
    ).toEqual({
      canEdit: true,
      supportedActions: ["split_entries", "retry", "edit_retry", "delete"],
    });
  });

  it("does not offer retry for a purely manual document without submitted input", () => {
    expect(
      deriveSourceDocumentCapabilities({
        latestSubmissionStatus: null,
        hasSubmissionInput: false,
      }).supportedActions
    ).not.toContain("retry");
  });
});
