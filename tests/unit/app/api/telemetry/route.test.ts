import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "tests/helpers/session";

// The route's own auth helper stays real; only the session lookup it ends in is stood in for.
vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

import { POST } from "@/app/api/telemetry/route";

const BATCH = JSON.stringify({
  schemaVersion: 1,
  sentAt: "2026-10-02T00:00:00.000Z",
  context: { platform: "web", release: "dev" },
  events: [],
});

function relayRequest(method = "POST") {
  return new Request("http://localhost/api/telemetry", {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "POST" ? { body: BATCH } : {}),
  });
}

describe("POST /api/telemetry", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(getCurrentSession).mockReset();
    vi.mocked(getCurrentSession).mockResolvedValue(testSession());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("without INSIGHT_URL and INSIGHT_KEY", () => {
    it("answers 204 and forwards nothing, signed in or not", async () => {
      expect((await POST(relayRequest())).status).toBe(204);

      vi.mocked(getCurrentSession).mockResolvedValue(null);
      expect((await POST(relayRequest())).status).toBe(204);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("with telemetry configured", () => {
    beforeEach(() => {
      vi.stubEnv("INSIGHT_URL", "https://insight.example");
      vi.stubEnv("INSIGHT_KEY", "mi_test_key");
    });

    it("requires a signed-in session", async () => {
      vi.mocked(getCurrentSession).mockResolvedValue(null);

      const response = await POST(relayRequest());

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("forwards a signed-in batch with the server's key, which the browser never sees", async () => {
      const response = await POST(relayRequest());

      expect(response.status).toBe(204);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://insight.example/v1/ingest");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer mi_test_key");
      expect(init.body).toBeInstanceOf(Uint8Array);
    });

    it("answers 503 rather than throwing when the session lookup itself fails", async () => {
      vi.mocked(getCurrentSession).mockRejectedValue(new Error("database down"));

      expect((await POST(relayRequest())).status).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("answers 503 when the platform is unreachable, so the browser keeps its queue", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));

      expect((await POST(relayRequest())).status).toBe(503);
    });
  });
});
