import { describe, expect, it, vi } from "vitest";
import { onBackgroundWork, requestBackgroundWork } from "@/server/background/wake";

describe("background wake", () => {
  it("calls every subscriber and stops calling one that unsubscribed", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onBackgroundWork(first);
    const stopSecond = onBackgroundWork(second);

    requestBackgroundWork();
    stopFirst();
    requestBackgroundWork();
    stopSecond();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("is a no-op while nothing listens", () => {
    expect(() => requestBackgroundWork()).not.toThrow();
  });

  it("shares its subscribers through globalThis, across module instances", async () => {
    const listener = vi.fn();
    const stop = onBackgroundWork(listener);

    vi.resetModules();
    const other = await import("@/server/background/wake");
    other.requestBackgroundWork();
    stop();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
