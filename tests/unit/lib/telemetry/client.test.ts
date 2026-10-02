import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  track: vi.fn(),
  trackScreen: vi.fn(),
  reportVital: vi.fn(),
  startOp: vi.fn(),
  trackDialog: vi.fn(),
}));

vi.mock("@moli-insight/web", () => sdk);

async function loadClient() {
  vi.resetModules();
  return import("@/lib/telemetry/client");
}

describe("telemetry client", () => {
  beforeEach(() => {
    Object.values(sdk).forEach((mock) => mock.mockReset());
    sdk.startOp.mockReturnValue({ end: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState(null, "", "/");
  });

  describe("starting", () => {
    it("starts nothing unless the build enabled telemetry", async () => {
      vi.stubEnv("NEXT_PUBLIC_INSIGHT_ENABLED", "false");
      const client = await loadClient();

      client.startTelemetry();

      expect(client.isTelemetryEnabled()).toBe(false);
      expect(sdk.init).not.toHaveBeenCalled();
      expect(sdk.trackScreen).not.toHaveBeenCalled();
    });

    it("starts once through the same-origin relay, leaving screens to the router hook", async () => {
      vi.stubEnv("NEXT_PUBLIC_INSIGHT_ENABLED", "true");
      vi.stubEnv("NEXT_PUBLIC_GIT_SHA", "abc1234");
      window.history.replaceState(null, "", "/entries?callbackUrl=%2Fprivate");
      const client = await loadClient();

      client.startTelemetry();
      client.startTelemetry();

      expect(sdk.init).toHaveBeenCalledTimes(1);
      expect(sdk.init).toHaveBeenCalledWith({
        endpoint: "/api/telemetry",
        release: "abc1234",
        autoCapture: { screens: false },
      });
      // The first screen, by path only.
      expect(sdk.trackScreen).toHaveBeenCalledWith("/entries", "app");
    });

    it("never throws into the app when the SDK does", async () => {
      vi.stubEnv("NEXT_PUBLIC_INSIGHT_ENABLED", "true");
      sdk.init.mockImplementation(() => {
        throw new Error("sdk broke");
      });
      const client = await loadClient();

      expect(() => client.startTelemetry()).not.toThrow();
    });
  });

  describe("events", () => {
    it("passes a business event to the SDK and swallows an SDK failure", async () => {
      const client = await loadClient();

      client.track("period.switch", { tab: "stats", range: "month", offset: -1 });
      expect(sdk.track).toHaveBeenCalledWith("period.switch", {
        tab: "stats",
        range: "month",
        offset: -1,
      });

      sdk.track.mockImplementation(() => {
        throw new Error("sdk broke");
      });
      expect(() => client.track("stats.view", { view: "trend" })).not.toThrow();
    });

    it("records a screen by path for each router transition, once per path", async () => {
      vi.stubEnv("NEXT_PUBLIC_INSIGHT_ENABLED", "true");
      window.history.replaceState(null, "", "/");
      const client = await loadClient();
      client.startTelemetry();
      sdk.trackScreen.mockClear();

      client.trackScreenTransition("/stats?view=trend&token=secret", "push");
      client.trackScreenTransition("/stats?view=cumulative", "replace");
      client.trackScreenTransition("/", "traverse");

      expect(sdk.trackScreen.mock.calls).toEqual([
        ["/stats", "push"],
        ["/", "back"],
      ]);
    });

    it("forwards only the five web vitals, with a rating it knows", async () => {
      const client = await loadClient();

      client.reportWebVital({ name: "LCP", value: 1200, rating: "good" });
      client.reportWebVital({ name: "INP", value: 80, rating: "weird" });
      client.reportWebVital({ name: "Next.js-hydration", value: 400 });

      expect(sdk.reportVital.mock.calls).toEqual([
        [{ name: "LCP", value: 1200, rating: "good" }],
        [{ name: "INP", value: 80 }],
      ]);
    });

    it("times an operation and ends it once as ok or failed", async () => {
      const end = vi.fn();
      sdk.startOp.mockReturnValue({ end });
      const client = await loadClient();

      client.startOperation("entry.update").succeed();
      client.startOperation("entry.update").fail("NETWORK");

      expect(sdk.startOp).toHaveBeenCalledWith("entry.update");
      expect(end.mock.calls).toEqual([[{ ok: true }], [{ ok: false, errorKind: "NETWORK" }]]);
    });

    it("hands back an inert operation when the SDK cannot start one", async () => {
      sdk.startOp.mockImplementation(() => {
        throw new Error("sdk broke");
      });
      const client = await loadClient();

      const op = client.startOperation("x");

      expect(() => op.succeed()).not.toThrow();
      expect(() => op.fail("y")).not.toThrow();
    });

    it("records a dialog with and without how it closed", async () => {
      const client = await loadClient();

      client.trackDialog("period.picker", "open");
      client.trackDialog("period.picker", "close", "escape");

      expect(sdk.trackDialog.mock.calls).toEqual([
        ["period.picker", "open", undefined],
        ["period.picker", "close", { closeBy: "escape" }],
      ]);
    });
  });

  describe("errorKindOf", () => {
    it("names a failure by code, else by type, and never by message", async () => {
      const { errorKindOf } = await loadClient();

      expect(errorKindOf(Object.assign(new Error("secret"), { code: "LEDGER_QUERY_FAILED" }))).toBe(
        "LEDGER_QUERY_FAILED"
      );
      expect(errorKindOf(new TypeError("secret"))).toBe("TypeError");
      expect(errorKindOf("secret")).toBe("unknown");
      expect(errorKindOf(null)).toBe("unknown");
    });
  });
});
