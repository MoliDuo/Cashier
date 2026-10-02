import { afterEach, describe, expect, it } from "vitest";
import { DEVICE_ID_STORAGE_KEY, QUEUE_STORAGE_PREFIX, STORAGE_KEY_PREFIX } from "@moli-insight/web";
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

  it("keeps the telemetry SDK's device id and unsent queue, so a sign-out is not a new device", () => {
    const queueKey = `${QUEUE_STORAGE_PREFIX}tab-1`;
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, "dev_abc");
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}session`, "ses_abc.1");
    window.localStorage.setItem(queueKey, '{"t":1,"e":[]}');
    window.localStorage.setItem("cashier:new-record-book", "book-1");

    forgetLedgerDataOnThisDevice();

    expect(window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)).toBe("dev_abc");
    expect(window.localStorage.getItem(`${STORAGE_KEY_PREFIX}session`)).toBe("ses_abc.1");
    expect(window.localStorage.getItem(queueKey)).toBe('{"t":1,"e":[]}');
    expect(window.localStorage.getItem("cashier:new-record-book")).toBeNull();
  });
});
