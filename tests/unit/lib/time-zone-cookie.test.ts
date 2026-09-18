import { describe, expect, it } from "vitest";
import {
  DEVICE_TIME_ZONE_COOKIE,
  buildDeviceTimeZoneCookie,
  parseDeviceTimeZoneCookie,
  resolveRequestTimeZone,
} from "@/lib/time-zone-cookie";

describe("resolveRequestTimeZone", () => {
  it("prefers the viewed book's own zone", () => {
    expect(
      resolveRequestTimeZone({
        bookTimeZone: "Asia/Shanghai",
        deviceTimeZone: "America/New_York",
        fallbackTimeZone: "UTC",
      })
    ).toBe("Asia/Shanghai");
  });

  it("falls to the device zone when the book has none", () => {
    expect(
      resolveRequestTimeZone({
        bookTimeZone: null,
        deviceTimeZone: "America/New_York",
        fallbackTimeZone: "UTC",
      })
    ).toBe("America/New_York");
  });

  it("falls to the deployment zone when neither knows one", () => {
    // An API upload has no device; so does a browser that has not reported yet.
    expect(resolveRequestTimeZone({ fallbackTimeZone: "Asia/Tokyo" })).toBe("Asia/Tokyo");
    expect(
      resolveRequestTimeZone({
        bookTimeZone: "",
        deviceTimeZone: null,
        fallbackTimeZone: "Asia/Tokyo",
      })
    ).toBe("Asia/Tokyo");
  });
});

describe("device time zone cookie", () => {
  it("round-trips a zone through the cookie value", () => {
    const serialized = buildDeviceTimeZoneCookie("Asia/Kuala_Lumpur");
    expect(serialized).toContain(`${DEVICE_TIME_ZONE_COOKIE}=Asia/Kuala_Lumpur`);
    expect(serialized).toContain("path=/");
    expect(serialized).toContain("samesite=lax");
    expect(parseDeviceTimeZoneCookie("Asia/Kuala_Lumpur")).toBe("Asia/Kuala_Lumpur");
  });

  it("ignores a missing, empty, or forged zone", () => {
    expect(parseDeviceTimeZoneCookie(null)).toBeNull();
    expect(parseDeviceTimeZoneCookie(undefined)).toBeNull();
    expect(parseDeviceTimeZoneCookie("")).toBeNull();
    expect(parseDeviceTimeZoneCookie("Not/AZone")).toBeNull();
    expect(parseDeviceTimeZoneCookie("Asia/Shanghai; drop table books")).toBeNull();
  });
});
