import { describe, expect, it } from "vitest";
import { uniquePagedItems } from "@/modules/workspace/paged-items";

describe("uniquePagedItems", () => {
  it("keeps each item once, where it was first read", () => {
    const pages = [
      { items: [{ id: "a" }, { id: "b" }] },
      { items: [{ id: "b", late: true }, { id: "c" }] },
    ];
    expect(uniquePagedItems(pages)).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });

  it("reads nothing from a list that has not loaded", () => {
    expect(uniquePagedItems(undefined)).toEqual([]);
  });
});
