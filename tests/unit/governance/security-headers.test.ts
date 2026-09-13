import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("global security headers", () => {
  it("configures baseline browser security policies for every route", async () => {
    const entries = await nextConfig.headers?.();
    const globalHeaders = entries?.find((entry) => entry.source === "/:path*")?.headers;
    expect(globalHeaders).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
      ])
    );
  });
});
