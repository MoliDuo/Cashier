import { describe, expect, it } from "vitest";
import { sanitizeCallbackPath } from "@/modules/auth/domain/callback-path";

describe("sanitizeCallbackPath", () => {
  it.each(["/", "/entries", "/entries?tab=all&page=2", "/ledger/abc/settings#emails"])(
    "keeps the same-site path %s",
    (path) => {
      expect(sanitizeCallbackPath(path)).toBe(path);
    }
  );

  it.each([
    ["nothing", null],
    ["nothing", undefined],
    ["an empty string", ""],
    ["a relative path", "entries"],
    ["an absolute URL", "https://evil.example/entries"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash host", "/\\evil.example"],
    ["a newline", "/entries\nSet-Cookie: x=1"],
    ["a tab", "/\tentries"],
    ["a NUL", "/entries\u0000"],
    ["a DEL", "/entries\u007f"],
  ])("falls back to the front page for %s", (_label, value) => {
    expect(sanitizeCallbackPath(value)).toBe("/");
  });
});
