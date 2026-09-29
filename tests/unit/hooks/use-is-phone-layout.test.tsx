import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsPhoneLayout } from "@/hooks/use-is-phone-layout";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

afterEach(() => {
  if (originalMatchMedia != null) Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
});

describe("useIsPhoneLayout", () => {
  it("is true below the md breakpoint", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsPhoneLayout());
    expect(result.current).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 47.99rem)");
  });

  it("is false from md up", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useIsPhoneLayout());
    expect(result.current).toBe(false);
  });

  it("is false where the browser cannot answer", () => {
    Reflect.deleteProperty(window, "matchMedia");
    const { result } = renderHook(() => useIsPhoneLayout());
    expect(result.current).toBe(false);
  });
});
