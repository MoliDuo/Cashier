import { describe, expect, it } from "vitest";
import fixture from "@/../tests/fixtures/api-v1/source-documents.post.json";
import {
  apiV1Compatibility,
  toApiV1SourceDocumentCreateResponse,
} from "@/app/api/v1/_shared/compatibility";
import { toApplicationError, type ApplicationErrorContract } from "@/lib/application-errors";
import {
  supportedSourceDocumentActions,
  toStableFailureCode,
} from "@/modules/source-document/lifecycle";
import { AppError } from "@/lib/errors";

describe("target application contracts", () => {
  it("exposes actions for stable document lifecycle states", () => {
    const cases = [
      [
        {
          activeRevisionId: "revision-1",
          latestSubmissionStatus: "failed" as const,
          hasSubmissionInput: true,
        },
        ["split_entries", "retry", "edit_retry", "delete"],
      ],
      [
        {
          activeRevisionId: null,
          latestSubmissionStatus: "cancelled" as const,
          hasSubmissionInput: true,
        },
        ["retry", "edit_retry", "delete"],
      ],
      [
        {
          activeRevisionId: "revision-1",
          latestSubmissionStatus: "completed" as const,
          hasSubmissionInput: true,
        },
        ["split_entries", "retry", "edit_retry", "delete"],
      ],
      [
        {
          activeRevisionId: null,
          latestSubmissionStatus: "failed" as const,
          hasSubmissionInput: true,
          deleted: true,
        },
        [],
      ],
    ] as const;

    for (const [input, actions] of cases) {
      expect(supportedSourceDocumentActions(input)).toEqual(actions);
    }
  });

  it("only exposes splitting for a completed active document without pending work", () => {
    expect(
      supportedSourceDocumentActions({
        activeRevisionId: "revision-1",
        latestSubmissionStatus: null,
        hasSubmissionInput: false,
      })
    ).toContain("split_entries");
    for (const input of [
      {
        activeRevisionId: "revision-1",
        latestSubmissionStatus: "processing" as const,
        hasSubmissionInput: true,
      },
      { activeRevisionId: null, latestSubmissionStatus: null, hasSubmissionInput: false },
    ]) {
      expect(supportedSourceDocumentActions(input)).not.toContain("split_entries");
    }
  });

  it("maps infrastructure failures to stable, non-sensitive application errors", () => {
    const error: ApplicationErrorContract = toApplicationError(
      new AppError("Failed to download /private/uploads/secret.jpg", "S3_DOWNLOAD_FAILED")
    );

    expect(error.code).toBe("STORAGE_UNAVAILABLE");
    expect(error.message).not.toContain("/private");
    expect(error.correlationId).toBeTypeOf("string");
  });

  it("keeps the published API v1 response fixture as a stable contract", () => {
    const response = fixture.response as {
      sourceDocumentId: string;
      revisionId: string;
      revisionState: "processing";
    };
    expect(
      toApiV1SourceDocumentCreateResponse({
        sourceDocumentId: response.sourceDocumentId,
        revisionId: response.revisionId,
        processingStatus: response.revisionState,
      })
    ).toEqual(fixture.response);
    expect(apiV1Compatibility.version).toBe(fixture.compatibility.version);
    expect(apiV1Compatibility.status).toBe(fixture.compatibility.status);
  });

  describe("toStableFailureCode", () => {
    it("preserves stable codes and reports anything else as processing_unavailable", () => {
      const cases = [
        ["ai_provider_unavailable", "ai_provider_unavailable"],
        ["exchange_rate_failure", "exchange_rate_failure"],
        ["INTERNAL", "processing_unavailable"],
        ["database_unavailable", "processing_unavailable"],
        ["SOME_UNKNOWN_CODE", "processing_unavailable"],
        [null, "processing_unavailable"],
      ] as const;
      for (const [input, expected] of cases) expect(toStableFailureCode(input)).toBe(expected);
    });
  });
});
