import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInsight, sendServerEvent } from "@/lib/telemetry/server";

const finished = { outcome: "completed", ms: 1200, runs: 1 } as const;

describe("telemetry server", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is disabled, and sends nothing, without INSIGHT_URL and INSIGHT_KEY", async () => {
    expect(getInsight().enabled).toBe(false);

    await sendServerEvent("processing.finished", finished, "correlation-1");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays disabled with only one of the two set", () => {
    vi.stubEnv("INSIGHT_URL", "https://insight.example");
    expect(getInsight().enabled).toBe(false);

    vi.stubEnv("INSIGHT_URL", "");
    vi.stubEnv("INSIGHT_KEY", "mi_key");
    expect(getInsight().enabled).toBe(false);
  });

  it("sends a server event with its correlation id and the ingest key", async () => {
    vi.stubEnv("INSIGHT_URL", "https://insight.example/");
    vi.stubEnv("INSIGHT_KEY", "mi_test_key");

    await sendServerEvent("processing.finished", finished, "6c411660-27ff-4712-ae1d-6eba4ae19c48");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://insight.example/v1/ingest");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer mi_test_key");
    const body = JSON.parse(init.body as string);
    expect(body.context.platform).toBe("server");
    // Tagged like the browser's events, even where the build has no commit SHA.
    expect(body.context.release).toBe(process.env.NEXT_PUBLIC_GIT_SHA ?? "dev");
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      name: "processing.finished",
      correlationId: "6c411660-27ff-4712-ae1d-6eba4ae19c48",
      props: finished,
    });
  });

  it("omits the correlation id when the job had none", async () => {
    vi.stubEnv("INSIGHT_URL", "https://insight.example");
    vi.stubEnv("INSIGHT_KEY", "mi_test_key");

    await sendServerEvent("processing.finished", finished);

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.events[0]).not.toHaveProperty("correlationId");
  });

  it("follows a change of configuration", () => {
    vi.stubEnv("INSIGHT_URL", "https://insight.example");
    vi.stubEnv("INSIGHT_KEY", "mi_test_key");
    const first = getInsight();
    expect(getInsight()).toBe(first);

    vi.stubEnv("INSIGHT_KEY", "mi_other_key");
    expect(getInsight()).not.toBe(first);
  });

  it("never throws: not for an unreachable platform, not for an invalid URL", async () => {
    vi.stubEnv("INSIGHT_URL", "https://insight.example");
    vi.stubEnv("INSIGHT_KEY", "mi_test_key");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(sendServerEvent("processing.finished", finished, "c")).resolves.toBeUndefined();

    vi.stubEnv("INSIGHT_URL", "not a url");
    await expect(sendServerEvent("processing.finished", finished, "c")).resolves.toBeUndefined();
  });
});
