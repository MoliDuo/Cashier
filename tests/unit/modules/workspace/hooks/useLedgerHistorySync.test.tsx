import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStackStore } from "@/lib/store/modal-stack";
import { useLedgerHistorySync } from "@/modules/workspace/hooks/useLedgerHistorySync";

const detailId = "document-1";
const detailSearch = `detailType=source-document&detailId=${detailId}`;

describe("useLedgerHistorySync", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", `/?${detailSearch}`);
    useModalStackStore.getState().closeAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    useModalStackStore.getState().closeAll();
  });

  it("opens the detail the URL names and closes it when the URL drops it, without asking", async () => {
    const go = vi.spyOn(window.history, "go");
    const { rerender } = renderHook(
      ({ search }) =>
        useLedgerHistorySync({ pathname: "/", searchParams: new URLSearchParams(search) }),
      { initialProps: { search: detailSearch } }
    );

    await waitFor(() =>
      expect(useModalStackStore.getState().stack).toEqual([
        { type: "source-document", id: detailId, returnFocus: null },
      ])
    );

    // Browser back to the list: the sheet closes; history is never pulled back.
    window.history.replaceState({}, "", "/");
    rerender({ search: "" });

    await waitFor(() => expect(useModalStackStore.getState().stack).toEqual([]));
    expect(go).not.toHaveBeenCalled();
  });
});
