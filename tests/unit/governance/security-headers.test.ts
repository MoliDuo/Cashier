import { describe, expect, it, vi } from "vitest";

// The next-intl plugin pulls a native file watcher in, and a native addon
// loaded from two worker threads at once fails to register. Nothing here needs
// the plugin's behaviour — only the config object it is handed.
vi.mock("next-intl/plugin", () => ({
  default:
    () =>
    <T>(config: T) =>
      config,
}));

describe("global security headers", () => {
  it("configures baseline browser security policies for every route", async () => {
    const nextConfig = (await import("../../../next.config")).default;
    const entries = await nextConfig.headers?.();
    const globalHeaders = entries?.find((entry) => entry.source === "/:path*")?.headers;
    expect(globalHeaders).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        {
          key: "Content-Security-Policy",
          value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
        },
      ])
    );
  });

  it("covers every route from one rule rather than a handful of paths", async () => {
    const nextConfig = (await import("../../../next.config")).default;
    const entries = (await nextConfig.headers?.()) ?? [];

    // A second, narrower source would mean some routes carry the policies and
    // others quietly do not, which is the gap this header set exists to close.
    expect(entries.map((entry) => entry.source)).toEqual(["/:path*"]);
  });
});
