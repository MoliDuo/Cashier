import { describe, expect, it } from "vitest";
import { resolveBatchCategoryPick } from "@/modules/ledger/ui/batch-action-toolbar";

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

  it("accepts every category in the default preset", () => {
    const categories = Array.from({ length: 13 }, (_, i) => `c${i}`);
    expect(resolveBatchCategoryPick({ categoryIds: categories, clearPicked: false })).toEqual({
      kind: "ai",
      categoryIds: categories,
    });
  });

  it("keeps clearing out of the candidates the model weighs", () => {
    expect(
      resolveBatchCategoryPick({ categoryIds: ["category-1", "category-2"], clearPicked: true })
    ).toEqual({ kind: "clear" });
  });
});
