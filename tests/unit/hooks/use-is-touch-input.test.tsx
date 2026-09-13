import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsTouchInput } from "@/hooks/use-is-touch-input";

function stubEnvironment(options: {
  coarse: boolean;
  desktopLike: boolean;
  touchPoints?: number;
  mobileHint?: boolean;
}) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(pointer: coarse)" ? options.coarse : options.desktopLike,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: options.touchPoints ?? 0,
  });
  if (options.mobileHint != null) {
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      value: { mobile: options.mobileHint },
    });
  }
}

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

afterEach(() => {
  if (originalMatchMedia != null) Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(navigator, "maxTouchPoints");
  Reflect.deleteProperty(navigator, "userAgentData");
});

describe("useIsTouchInput", () => {
  it("reads a finger-driven phone as touch", () => {
    stubEnvironment({ coarse: true, desktopLike: false, touchPoints: 5 });

    expect(renderHook(() => useIsTouchInput()).result.current).toBe(true);
  });

  it("reads a laptop with a mouse as a desktop", () => {
    stubEnvironment({ coarse: false, desktopLike: true, touchPoints: 0 });

    expect(renderHook(() => useIsTouchInput()).result.current).toBe(false);
  });

  it("keeps a touchscreen laptop with a trackpad on the desktop side", () => {
    stubEnvironment({ coarse: false, desktopLike: true, touchPoints: 10 });

    expect(renderHook(() => useIsTouchInput()).result.current).toBe(false);
  });

  it("still reads a touch device as touch when the pointer reports fine", () => {
    stubEnvironment({ coarse: false, desktopLike: false, touchPoints: 5 });

    expect(renderHook(() => useIsTouchInput()).result.current).toBe(true);
  });

  it("trusts Chromium's own mobile hint when every pointer query says desktop", () => {
    stubEnvironment({ coarse: false, desktopLike: true, touchPoints: 0, mobileHint: true });

    expect(renderHook(() => useIsTouchInput()).result.current).toBe(true);
  });
});
