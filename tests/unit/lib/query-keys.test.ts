import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/query-keys";

describe("queryKeys", () => {
  it("keeps detail and input projections distinct for the same source document", () => {
    const projections = [
      queryKeys.sourceDocument("document-1"),
      queryKeys.sourceDocumentInput("document-1"),
    ];

    expect(new Set(projections.map((key) => JSON.stringify(key))).size).toBe(projections.length);
  });

  it("normalizes omitted and undefined filters to stable cache keys", () => {
    expect(queryKeys.summary()).toEqual(queryKeys.summary(null));
    expect(queryKeys.summary()).toEqual(queryKeys.summary(undefined));
    expect(queryKeys.summary({ endDate: undefined })).toEqual(queryKeys.summary({ endDate: null }));
  });
});
