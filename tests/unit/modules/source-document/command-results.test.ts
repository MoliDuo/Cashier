import { describe, expect, it } from "vitest";
import {
  SourceDocumentStaleCommandError,
  unwrapVersionedCommandResult,
} from "@/modules/source-document/command-results";

describe("source document command result unwrapping", () => {
  it("unwraps a versioned success", () => {
    expect(
      unwrapVersionedCommandResult({
        ok: true,
        sourceDocumentId: "document-1",
        version: 2,
        data: { value: 1 },
      })
    ).toEqual({ value: 1 });
  });

  it("converts a versioned stale result into a single stale target", () => {
    try {
      unwrapVersionedCommandResult({
        ok: false,
        reason: "stale",
        sourceDocumentId: "document-1",
        expectedVersion: 1,
        currentVersion: 2,
      });
      throw new Error("Expected stale command to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SourceDocumentStaleCommandError);
      expect((error as SourceDocumentStaleCommandError).staleTargets).toEqual([
        { sourceDocumentId: "document-1", expectedVersion: 1, currentVersion: 2 },
      ]);
    }
  });
});
