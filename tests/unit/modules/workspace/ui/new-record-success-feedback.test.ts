import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStackStore } from "@/lib/store/modal-stack";

const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock },
}));

import {
  shouldWarnNewRecordMayBeHidden,
  shouldWarnNewRecordSavedToOtherBook,
  showNewRecordSuccessFeedback,
} from "@/modules/workspace/ui/new-record-success-feedback";

const messages = {
  aiSuccess: "AI saved",
  quickSuccess: "Quick saved",
  savedMayBeHidden: "Saved but hidden",
  savedToOtherBook: (bookName: string) => `Saved to ${bookName} but not visible`,
  viewRecord: "View record",
};

const viewedBookId = "book-viewed";
const viewedBook = { id: viewedBookId, name: "Daily" };

describe("new record success feedback", () => {
  beforeEach(() => {
    toastSuccessMock.mockReset();
    useModalStackStore.getState().closeAll();
    window.history.replaceState(
      { next: "preserved" },
      "",
      "/ledger-1?tab=stats&streamSearch=lunch"
    );
  });

  it("shows a single action toast and preserves filters when opening the record", () => {
    showNewRecordSuccessFeedback({
      mode: "ai",
      ledgerId: "ledger-1",
      result: { sourceDocumentId: "source-1", documentDate: "2026-07-17" },
      activeTab: "stats",
      committedFilters: {},
      viewedBookId,
      savedBook: viewedBook,
      messages,
    });

    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Saved but hidden",
      expect.objectContaining({
        action: expect.objectContaining({ label: "View record" }),
      })
    );

    const options = toastSuccessMock.mock.calls[0]?.[1] as {
      action: { onClick: () => void };
    };
    options.action.onClick();

    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("stats");
    expect(params.get("streamSearch")).toBe("lunch");
    expect(params.get("detailType")).toBe("source-document");
    expect(params.get("detailId")).toBe("source-1");
    expect(window.history.state).toMatchObject({
      next: "preserved",
      cashier: { ledgerNavigation: true, kind: "detail" },
    });
    expect(useModalStackStore.getState().stack).toEqual([
      {
        type: "source-document",
        id: "source-1",
        ledgerId: "ledger-1",
        returnFocus: document.body,
      },
    ]);
  });

  it("uses the mode-specific generic toast for an unfiltered in-range Stream record", () => {
    showNewRecordSuccessFeedback({
      mode: "quick",
      ledgerId: "ledger-1",
      result: { sourceDocumentId: "source-2", documentDate: "2026-07-17" },
      activeTab: "stream",
      committedFilters: {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      },
      viewedBookId,
      savedBook: viewedBook,
      messages,
    });

    expect(toastSuccessMock).toHaveBeenCalledOnce();
    expect(toastSuccessMock).toHaveBeenCalledWith("Quick saved");
  });

  it("names the book and warns that it is out of view when saved elsewhere", () => {
    showNewRecordSuccessFeedback({
      mode: "quick",
      ledgerId: "ledger-1",
      result: { sourceDocumentId: "source-3", documentDate: "2026-07-17" },
      activeTab: "stream",
      committedFilters: {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      },
      viewedBookId,
      savedBook: { id: "book-other", name: "Travel" },
      messages,
    });

    expect(toastSuccessMock).toHaveBeenCalledOnce();
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Saved to Travel but not visible",
      expect.objectContaining({
        action: expect.objectContaining({ label: "View record" }),
      })
    );
  });

  it("does not treat 总账 as another book, because every book stays visible there", () => {
    expect(shouldWarnNewRecordSavedToOtherBook(null, { id: "book-2", name: "Travel" })).toBe(false);
    expect(shouldWarnNewRecordSavedToOtherBook(viewedBookId, viewedBook)).toBe(false);
    expect(
      shouldWarnNewRecordSavedToOtherBook(viewedBookId, { id: "book-2", name: "Travel" })
    ).toBe(true);

    showNewRecordSuccessFeedback({
      mode: "ai",
      ledgerId: "ledger-1",
      result: { sourceDocumentId: "source-4", documentDate: "2026-07-17" },
      activeTab: "stream",
      committedFilters: {},
      viewedBookId: null,
      savedBook: { id: "book-2", name: "Travel" },
      messages,
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("AI saved");
  });

  it("warns for narrowing filters and dates outside the committed range", () => {
    expect(
      shouldWarnNewRecordMayBeHidden("stream", { statuses: ["processing"] }, "2026-07-17")
    ).toBe(true);
    expect(
      shouldWarnNewRecordMayBeHidden(
        "stream",
        { startDate: "2026-07-18", endDate: "2026-07-31" },
        "2026-07-17"
      )
    ).toBe(true);
  });
});
