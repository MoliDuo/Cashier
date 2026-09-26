import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDraft,
  draftKey,
  keepDraftInMemory,
  readDraft,
  takeDraftFromMemory,
  writeDraft,
} from "@/lib/drafts";

const parseText = (data: unknown) =>
  typeof data === "object" && data != null && typeof (data as { text?: unknown }).text === "string"
    ? (data as { text: string })
    : null;

describe("drafts", () => {
  const key = draftKey("ledger-1", "new-record-ai", "new");

  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("scopes a key by ledger, kind and record", () => {
    expect(key).toBe("draft:ledger-1:new-record-ai:new");
    expect(draftKey("ledger-2", "source-document", "doc-1")).toBe(
      "draft:ledger-2:source-document:doc-1"
    );
  });

  it("reads back what was written, with its basis", () => {
    writeDraft(key, { text: "午饭" }, "3");
    expect(readDraft(key, parseText)).toEqual({ data: { text: "午饭" }, basis: "3" });
    clearDraft(key);
    expect(readDraft(key, parseText)).toBeNull();
  });

  it("drops a draft that is corrupt, of another shape or over a week old", () => {
    window.localStorage.setItem(key, "{not json");
    expect(readDraft(key, parseText)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();

    writeDraft(key, { text: 1 });
    expect(readDraft(key, parseText)).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
    writeDraft(key, { text: "old" });
    vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
    expect(readDraft(key, parseText)).toBeNull();
  });

  it("degrades to no draft where storage throws", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeDraft(key, { text: "x" })).not.toThrow();
    expect(readDraft(key, parseText)).toBeNull();
  });

  it("hands what storage cannot hold to the next taker only once", () => {
    const files = [new Blob(["1"])];
    keepDraftInMemory(key, files);
    expect(takeDraftFromMemory(key)).toBe(files);
    expect(takeDraftFromMemory(key)).toBeUndefined();
    keepDraftInMemory(key, files);
    clearDraft(key);
    expect(takeDraftFromMemory(key)).toBeUndefined();
  });
});
