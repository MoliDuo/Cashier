import { afterEach, describe, expect, it } from "vitest";
import { getClientIPFromHeaders } from "@/lib/utils/ip";

const originalTrustedProxy = process.env.TRUSTED_PROXY;

afterEach(() => {
  if (originalTrustedProxy === undefined) delete process.env.TRUSTED_PROXY;
  else process.env.TRUSTED_PROXY = originalTrustedProxy;
});

describe("trusted proxy handling", () => {
  it("ignores forwarded addresses unless trusted proxy mode is enabled", () => {
    delete process.env.TRUSTED_PROXY;
    const headers = new Headers({
      "x-real-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.20",
    });

    expect(getClientIPFromHeaders(headers)).toBe("unknown");
  });

  it("accepts a single validated Docker proxy address", () => {
    process.env.TRUSTED_PROXY = "proxy";
    const headers = new Headers({ "x-real-ip": "198.51.100.20" });

    expect(getClientIPFromHeaders(headers)).toBe("198.51.100.20");
  });

  it("rejects multi-value, empty, and invalid proxy addresses", () => {
    process.env.TRUSTED_PROXY = "proxy";

    expect(getClientIPFromHeaders(new Headers({ "x-real-ip": "198.51.100.20, 10.0.0.1" }))).toBe(
      "unknown"
    );
    expect(getClientIPFromHeaders(new Headers({ "x-real-ip": "not-an-ip" }))).toBe("unknown");
    expect(getClientIPFromHeaders(new Headers())).toBe("unknown");
  });
});
