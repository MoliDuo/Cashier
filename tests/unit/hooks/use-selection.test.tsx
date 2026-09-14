import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSelection } from "@/hooks/use-selection";

const ALL_IDS = ["one", "two", "two"];

describe("useSelection", () => {
  it("keeps repeated select and deselect events idempotent", () => {
    const { result } = renderHook(() => useSelection({ allIds: ALL_IDS }));

    act(() => {
      result.current.handleSelect("one", true);
      result.current.handleSelect("one", true);
    });
    expect(result.current.selectedIds).toEqual(["one"]);

    act(() => {
      result.current.handleSelect("one", false);
      result.current.handleSelect("one", false);
    });
    expect(result.current.selectedIds).toEqual([]);
  });

  it("deduplicates IDs when selecting all", () => {
    const { result } = renderHook(() => useSelection({ allIds: ALL_IDS }));

    act(() => result.current.selectAll());
    expect(result.current.selectedIds).toEqual(["one", "two"]);
    expect(result.current.isAllSelected).toBe(true);
  });

  it("exits selection mode on Escape when no overlay is open", () => {
    const { result } = renderHook(() => useSelection({ allIds: ALL_IDS }));

    act(() => {
      result.current.setSelectionMode(true);
      result.current.selectAll();
    });
    expect(result.current.isSelectionMode).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(result.current.isSelectionMode).toBe(false);
    expect(result.current.selectedIds).toEqual([]);
  });

  it("keeps selection mode while a Radix overlay is open", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-radix-dialog-content", "");
    overlay.setAttribute("data-state", "open");
    document.body.appendChild(overlay);

    const { result } = renderHook(() => useSelection({ allIds: ALL_IDS }));
    act(() => {
      result.current.setSelectionMode(true);
      result.current.selectAll();
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(result.current.isSelectionMode).toBe(true);
    expect(result.current.selectedIds).toEqual(["one", "two"]);
    overlay.remove();
  });

  it("caps selection at 100 while allowing any visible item after one is cleared", () => {
    const ids = Array.from({ length: 101 }, (_, index) => `entry-${index + 1}`);
    const { result } = renderHook(() => useSelection({ allIds: ids }));

    act(() => result.current.selectAll());
    expect(result.current.selectedIds).toHaveLength(100);
    expect(result.current.selectableCount).toBe(100);
    expect(result.current.isSelectionLimitReached).toBe(true);
    expect(result.current.isAllSelected).toBe(true);

    act(() => result.current.toggleSelection("entry-101"));
    expect(result.current.selectedIds).not.toContain("entry-101");

    act(() => {
      result.current.toggleSelection("entry-1");
      result.current.toggleSelection("entry-101");
    });
    expect(result.current.selectedIds).toHaveLength(100);
    expect(result.current.selectedIds).toContain("entry-101");
  });

  it("selects every loaded item when the caller disables the cap", () => {
    const ids = Array.from({ length: 150 }, (_, index) => `entry-${index + 1}`);
    const { result, rerender } = renderHook(
      ({ allIds }) => useSelection({ allIds, maxSelected: null }),
      { initialProps: { allIds: ids } }
    );

    act(() => result.current.selectAll());
    expect(result.current.selectedIds).toHaveLength(150);
    expect(result.current.isAllSelected).toBe(true);

    rerender({ allIds: [...ids, "entry-151"] });
    expect(result.current.selectedIds).toHaveLength(150);
    expect(result.current.isAllSelected).toBe(false);
  });

  it("takes and gives back a whole day in one update", () => {
    const { result } = renderHook(() => useSelection({ allIds: ["a", "b", "c", "d"] }));

    act(() => result.current.handleSelectMany(["a", "b"], true));
    expect(result.current.selectedIds).toEqual(["a", "b"]);

    // Re-selecting a day keeps what was already in and adds the rest, so the
    // day ends up whole however it was entered.
    act(() => result.current.handleSelectMany(["b", "c"], true));
    expect(result.current.selectedIds).toEqual(["a", "b", "c"]);

    act(() => result.current.handleSelectMany(["a", "c"], false));
    expect(result.current.selectedIds).toEqual(["b"]);
  });

  it("lets a day fill the last of the batch budget but never past it", () => {
    const ids = Array.from({ length: 101 }, (_, index) => `entry-${index + 1}`);
    const { result } = renderHook(() => useSelection({ allIds: ids }));

    act(() => result.current.handleSelectMany(["entry-1", "entry-2"], true));
    act(() => result.current.handleSelectMany(ids, true));
    expect(result.current.selectedIds).toHaveLength(100);
    expect(result.current.selectedIds[0]).toBe("entry-1");

    // Clearing a day only removes that day's rows.
    act(() => result.current.handleSelectMany(["entry-1", "entry-2"], false));
    expect(result.current.selectedIds).not.toContain("entry-1");
    expect(result.current.selectedIds).toHaveLength(98);
  });

  it("intersects selection with refreshed visible IDs", () => {
    const { result, rerender } = renderHook(
      ({ allIds }) => useSelection({ allIds, queryFingerprint: "same-query" }),
      { initialProps: { allIds: ["one", "two", "three"] } }
    );
    act(() => {
      result.current.handleSelect("one", true);
      result.current.handleSelect("three", true);
    });

    rerender({ allIds: ["two", "three", "four"] });

    expect(result.current.selectedIds).toEqual(["three"]);
  });

  it("persists visible IDs so removed selections can be replaced without returning", async () => {
    const initialIds = Array.from({ length: 110 }, (_, index) => `entry-${index + 1}`);
    const replacementIds = initialIds.slice(10);
    const { result, rerender } = renderHook(
      ({ allIds }) => useSelection({ allIds, queryFingerprint: "same-query" }),
      { initialProps: { allIds: initialIds } }
    );

    act(() => result.current.selectAll());
    expect(result.current.selectedIds).toHaveLength(100);

    rerender({ allIds: replacementIds });
    expect(result.current.selectedIds).toHaveLength(90);

    act(() => {
      for (const id of replacementIds.slice(90)) result.current.handleSelect(id, true);
    });
    expect(result.current.selectedIds).toHaveLength(100);
    expect(result.current.selectedIds).toContain("entry-110");

    await waitFor(() => expect(result.current.selectedIds).toHaveLength(100));
    rerender({ allIds: initialIds });

    expect(result.current.selectedIds).not.toContain("entry-1");
    expect(result.current.selectedIds).toContain("entry-110");
  });
});
