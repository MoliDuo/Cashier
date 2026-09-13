import { describe, expect, it } from "vitest";
import { resolveBatchCategoryPick } from "@/modules/ledger/ui/batch-action-toolbar";
import { MAX_RECLASSIFICATION_CANDIDATES } from "@/modules/ledger/ui/batch-action-toolbar/batch-category-pick";

describe("resolveBatchCategoryPick", () => {
  it("asks for nothing until something is picked", () => {
    expect(resolveBatchCategoryPick({ categoryIds: [], clearPicked: false })).toEqual({
      kind: "none",
    });
  });

  it("reads one pick as the user's own answer", () => {
    expect(resolveBatchCategoryPick({ categoryIds: ["category-1"], clearPicked: false })).toEqual({
      kind: "assign",
      categoryId: "category-1",
    });
  });

  it("reads several picks as the model's question", () => {
    expect(
      resolveBatchCategoryPick({ categoryIds: ["category-1", "category-2"], clearPicked: false })
    ).toEqual({ kind: "ai", categoryIds: ["category-1", "category-2"] });
  });

  it("stops at the candidate limit, where the question stops being well posed", () => {
    const within = Array.from({ length: MAX_RECLASSIFICATION_CANDIDATES }, (_, i) => `c${i}`);
    const over = [...within, `c${MAX_RECLASSIFICATION_CANDIDATES}`];

    expect(resolveBatchCategoryPick({ categoryIds: within, clearPicked: false }).kind).toBe("ai");
    expect(resolveBatchCategoryPick({ categoryIds: over, clearPicked: false })).toEqual({
      kind: "tooMany",
    });
  });

  it("keeps clearing out of the candidates the model weighs", () => {
    expect(
      resolveBatchCategoryPick({ categoryIds: ["category-1", "category-2"], clearPicked: true })
    ).toEqual({ kind: "clear" });
  });
});
