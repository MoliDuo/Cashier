import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/query-keys";

describe("queryKeys", () => {
  it("isolates entity and collection caches by ledger", () => {
    expect(queryKeys.sourceDocument("ledger-a", "document-1")).not.toEqual(
      queryKeys.sourceDocument("ledger-b", "document-1")
    );
    expect(queryKeys.sourceDocumentStream("ledger-a")).not.toEqual(
      queryKeys.sourceDocumentStream("ledger-b")
    );
  });

  it("keeps detail and input projections distinct for the same source document", () => {
    const projections = [
      queryKeys.sourceDocument("ledger-1", "document-1"),
      queryKeys.sourceDocumentInput("ledger-1", "document-1"),
    ];

    expect(new Set(projections.map((key) => JSON.stringify(key))).size).toBe(projections.length);
  });

  it("normalizes omitted and undefined filters to stable cache keys", () => {
    expect(queryKeys.summary("ledger-1")).toEqual(queryKeys.summary("ledger-1", null));
    expect(queryKeys.summary("ledger-1")).toEqual(queryKeys.summary("ledger-1", undefined));
    expect(queryKeys.summary("ledger-1", { endDate: undefined })).toEqual(
      queryKeys.summary("ledger-1", { endDate: null })
    );
  });
});
