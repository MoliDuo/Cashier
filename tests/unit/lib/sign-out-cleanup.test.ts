import { afterEach, describe, expect, it } from "vitest";
import {
  draftKey,
  readDraft,
  writeDraft,
  keepDraftInMemory,
  takeDraftFromMemory,
} from "@/lib/drafts";
import { forgetLedgerDataOnThisDevice } from "@/lib/sign-out-cleanup";

describe("forgetLedgerDataOnThisDevice", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.cookie = "CASHIER_BOOK_SCOPE=; path=/; max-age=0";
  });

  it("clears drafts, the remembered books and nothing of the device's own", () => {
    const key = draftKey("new-record-ai", "new");
    writeDraft(key, { text: "午饭 35" });
    keepDraftInMemory(key, ["image"]);
    window.localStorage.setItem("cashier:new-record-book", "book-1");
    window.localStorage.setItem("theme", "dark");
    document.cookie = "CASHIER_BOOK_SCOPE=book-1; path=/";

    forgetLedgerDataOnThisDevice();

    expect(readDraft(key, (data) => data)).toBeNull();
    expect(takeDraftFromMemory(key)).toBeUndefined();
    expect(window.localStorage.getItem("cashier:new-record-book")).toBeNull();
    expect(document.cookie).not.toContain("CASHIER_BOOK_SCOPE=book-1");
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });
});
