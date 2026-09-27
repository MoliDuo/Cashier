import { beforeEach, describe, expect, it, vi } from "vitest";
import { quickEntryFormCopy, sourceDocumentInputCopy } from "@/copy/source-document";

const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock },
}));

import {
  shouldWarnNewRecordMayBeHidden,
  shouldWarnNewRecordSavedToOtherBook,
  showNewRecordSuccessFeedback,
} from "@/modules/workspace/ui/new-record-success-feedback";

const viewedBookId = "book-viewed";
const viewedBook = { id: viewedBookId, name: "Daily" };

describe("new record success feedback", () => {
  beforeEach(() => {
    toastSuccessMock.mockReset();
    window.history.replaceState({ next: "preserved" }, "", "/stats?range=year");
  });

  it("shows a single action toast and preserves filters when opening the record", () => {
    showNewRecordSuccessFeedback({
      mode: "ai",
      result: { sourceDocumentId: "source-1", documentDate: "2026-07-17" },
      activeTab: "stats",
      committedView: { filters: {}, range: null },
      viewedBookId,
      savedBook: viewedBook,
    });

    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      sourceDocumentInputCopy.savedMayBeHidden,
      expect.objectContaining({
        action: expect.objectContaining({ label: sourceDocumentInputCopy.viewRecord }),
      })
    );

    const options = toastSuccessMock.mock.calls[0]?.[1] as {
      action: { onClick: () => void };
    };
    options.action.onClick();

    const params = new URLSearchParams(window.location.search);
    expect(window.location.pathname).toBe("/stats");
    expect(params.get("range")).toBe("year");
    expect(params.get("detail")).toBe("source-1");
    expect(window.history.state).toMatchObject({
      next: "preserved",
      cashier: { ledgerNavigation: true, kind: "detail" },
    });
  });

  it("uses the mode-specific generic toast for an unfiltered in-range Stream record", () => {
    showNewRecordSuccessFeedback({
      mode: "quick",
      result: { sourceDocumentId: "source-2", documentDate: "2026-07-17" },
      activeTab: "records",
      committedView: { filters: {}, range: { from: "2026-07-01", to: "2026-07-31" } },
      viewedBookId,
      savedBook: viewedBook,
    });

    expect(toastSuccessMock).toHaveBeenCalledOnce();
    expect(toastSuccessMock).toHaveBeenCalledWith(quickEntryFormCopy.quickEntrySuccess);
  });

  it("names the book and warns that it is out of view when saved elsewhere", () => {
    showNewRecordSuccessFeedback({
      mode: "quick",
      result: { sourceDocumentId: "source-3", documentDate: "2026-07-17" },
      activeTab: "records",
      committedView: { filters: {}, range: { from: "2026-07-01", to: "2026-07-31" } },
      viewedBookId,
      savedBook: { id: "book-other", name: "Travel" },
    });

    expect(toastSuccessMock).toHaveBeenCalledOnce();
    expect(toastSuccessMock).toHaveBeenCalledWith(
      sourceDocumentInputCopy.savedToOtherBook({ book: "Travel" }),
      expect.objectContaining({
        action: expect.objectContaining({ label: sourceDocumentInputCopy.viewRecord }),
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
      result: { sourceDocumentId: "source-4", documentDate: "2026-07-17" },
      activeTab: "records",
      committedView: { filters: {}, range: null },
      viewedBookId: null,
      savedBook: { id: "book-2", name: "Travel" },
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(sourceDocumentInputCopy.uploadSuccess);
  });

  it("warns for narrowing filters and dates outside the committed range", () => {
    expect(
      shouldWarnNewRecordMayBeHidden(
        "records",
        { filters: { statuses: ["processing"] }, range: null },
        "2026-07-17"
      )
    ).toBe(true);
    expect(
      shouldWarnNewRecordMayBeHidden(
        "records",
        { filters: {}, range: { from: "2026-07-18", to: "2026-07-31" } },
        "2026-07-17"
      )
    ).toBe(true);
  });
});
