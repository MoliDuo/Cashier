import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { classifyFailure, retryDelayMs } from "@/lib/background/retry";

class WrappedFailure extends Error {}

describe("background failure classification", () => {
  it.each(["ai_rate_limited", "ai_provider_unavailable", "ai_timeout"])(
    "treats %s as transient",
    (code) => {
      expect(classifyFailure(new AppError("x", code))).toMatchObject({ kind: "transient", code });
    }
  );

  it("finds the provider's error behind a wrapper and keeps its retry hint", () => {
    const provider = new AppError("limited", "ai_rate_limited", 503, { retryAfterMs: 7_000 });
    expect(classifyFailure(new WrappedFailure("parse failed", { cause: provider }))).toEqual({
      kind: "transient",
      code: "ai_rate_limited",
      retryAfterMs: 7_000,
    });
  });

  it("treats an invalid provider configuration as needing an operator", () => {
    const invalid = new AppError("bad key", "ai_configuration_invalid", 500);
    expect(classifyFailure(new WrappedFailure("x", { cause: invalid }))).toMatchObject({
      kind: "configuration",
    });
  });

  it("treats anything else as permanent", () => {
    expect(classifyFailure(new Error("boom"))).toEqual({
      kind: "permanent",
      code: null,
      retryAfterMs: null,
    });
    expect(classifyFailure(new AppError("gone", "FILE_NOT_FOUND", 404))).toMatchObject({
      kind: "permanent",
      code: "FILE_NOT_FOUND",
    });
  });
});

describe("background retry delay", () => {
  it("backs off by a factor of four up to a minute", () => {
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt))).toEqual([
      2_000, 8_000, 32_000, 60_000, 60_000,
    ]);
  });

  it("waits at least as long as the provider asked", () => {
    expect(retryDelayMs(1, 45_000)).toBe(45_000);
    expect(retryDelayMs(3, 1_000)).toBe(32_000);
  });
});
