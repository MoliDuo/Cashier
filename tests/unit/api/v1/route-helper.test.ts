import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { handleApiV1Route } from "@/server/api-v1/request-pipeline";

const { rateLimiterMock, serviceCredentialsMock, getClientIPFromHeadersMock, loggerMock } =
  vi.hoisted(() => ({
    rateLimiterMock: {
      increment: vi.fn(),
    },
    serviceCredentialsMock: {
      authenticate: vi.fn(),
    },
    getClientIPFromHeadersMock: vi.fn(),
    loggerMock: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

vi.mock("@/modules/ledger/server/service-credentials", () => ({
  authenticateServiceCredential: serviceCredentialsMock.authenticate,
}));

vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: rateLimiterMock.increment,
}));

vi.mock("@/lib/utils/ip", () => ({
  getClientIPFromHeaders: getClientIPFromHeadersMock,
}));

vi.mock("@/lib/env/runtime", () => ({
  runtimeEnv: {
    apiRateLimitPerMinute: 60,
    apiKeyPepper: "unit-test-pepper",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: loggerMock,
}));

const now = Date.now();
const credential = { id: "cred-1", ledgerId: "ledger-1" };

function successResult(limit: number) {
  return { success: true, remaining: limit - 1, resetTime: now + 60_000 };
}

describe("api/v1 route helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientIPFromHeadersMock.mockReturnValue("203.0.113.5");
    rateLimiterMock.increment.mockImplementation(async (_key: string, limit: number) =>
      successResult(limit)
    );
    serviceCredentialsMock.authenticate.mockResolvedValue(credential);
  });

  it("returns 401 with WWW-Authenticate when the Authorization header is missing", async () => {
    const handler = vi.fn();
    const response = await handleApiV1Route(
      new NextRequest("http://localhost/api/v1/source-documents", { method: "POST" }),
      { logContext: "api/v1/source-documents", handler }
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(serviceCredentialsMock.authenticate).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts lowercase bearer and BEARER scheme spellings", async () => {
    const handler = vi.fn().mockResolvedValue({
      response: NextResponse.json({ ok: true }, { status: 200 }),
    });
    for (const scheme of ["bearer", "BEARER"]) {
      await handleApiV1Route(
        new NextRequest("http://localhost/api/v1/source-documents", {
          method: "POST",
          headers: { Authorization: `${scheme} sk_test_123` },
        }),
        { logContext: "api/v1/source-documents", handler }
      );
    }

    expect(serviceCredentialsMock.authenticate).toHaveBeenCalledTimes(2);
    expect(serviceCredentialsMock.authenticate).toHaveBeenNthCalledWith(1, "sk_test_123");
    expect(serviceCredentialsMock.authenticate).toHaveBeenNthCalledWith(2, "sk_test_123");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("rejects over the pre-auth IP limit without parsing the business request", async () => {
    rateLimiterMock.increment.mockImplementation(async (key: string, limit: number) =>
      key.startsWith("rl_api_v1_preauth:")
        ? { success: false, remaining: 0, resetTime: now + 60_000 }
        : successResult(limit)
    );
    const handler = vi.fn();
    const response = await handleApiV1Route(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: "Bearer sk_test_123" },
      }),
      { logContext: "api/v1/source-documents", handler }
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("120");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(serviceCredentialsMock.authenticate).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("shares the credential quota across different client IPs", async () => {
    const validKeys = new Set<string>();
    const preAuthKeys = new Set<string>();
    rateLimiterMock.increment.mockImplementation(async (key: string, limit: number) => {
      if (key.startsWith("rl_valid_cred:")) validKeys.add(key);
      if (key.startsWith("rl_api_v1_preauth:")) preAuthKeys.add(key);
      return successResult(limit);
    });
    const handler = vi.fn().mockResolvedValue({
      response: NextResponse.json({ ok: true }, { status: 200 }),
    });

    getClientIPFromHeadersMock
      .mockReturnValueOnce("203.0.113.5")
      .mockReturnValueOnce("198.51.100.9");
    await handleApiV1Route(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: "Bearer sk_test_123" },
      }),
      { logContext: "api/v1/source-documents", handler }
    );
    await handleApiV1Route(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: "Bearer sk_test_123" },
      }),
      { logContext: "api/v1/source-documents", handler }
    );

    // The formal quota key is derived from the credential only: one shared
    // bucket across IPs, while the pre-auth IP buckets stay distinct.
    expect(validKeys.size).toBe(1);
    expect(preAuthKeys.size).toBe(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("sets exact rate limit headers on successful responses", async () => {
    const handler = vi.fn().mockResolvedValue({
      response: NextResponse.json({ ok: true }, { status: 200 }),
    });
    const response = await handleApiV1Route(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: "Bearer sk_test_123" },
      }),
      { logContext: "api/v1/source-documents", handler }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("59");
    expect(response.headers.get("X-RateLimit-Reset")).toBe(
      String(Math.floor((now + 60_000) / 1000))
    );
  });

  it("sets Retry-After and rate limit headers on credential 429 responses", async () => {
    rateLimiterMock.increment.mockImplementation(async (key: string, limit: number) =>
      key.startsWith("rl_valid_cred:")
        ? { success: false, remaining: 0, resetTime: now + 60_000 }
        : successResult(limit)
    );
    const handler = vi.fn();
    const response = await handleApiV1Route(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: "Bearer sk_test_123" },
      }),
      { logContext: "api/v1/source-documents", handler }
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("X-RateLimit-Reset")).toBe(
      String(Math.floor((now + 60_000) / 1000))
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("logs each failed request exactly once with a stable errorCode", async () => {
    const handler = vi.fn();
    const response = await handleApiV1Route(
      new NextRequest("http://localhost/api/v1/source-documents", { method: "POST" }),
      { logContext: "api/v1/source-documents", handler }
    );

    expect(response.status).toBe(401);
    expect(loggerMock.info).not.toHaveBeenCalled();
    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const [payload] = loggerMock.warn.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      logContext: "api/v1/source-documents",
      status: 401,
      errorCode: "UNAUTHENTICATED",
      requestId: expect.any(String),
      durationMs: expect.any(Number),
    });
    expect(payload).not.toHaveProperty("key");
  });

  it("passes credential, request, and requestId to the handler without a key", async () => {
    const handler = vi.fn().mockResolvedValue({
      response: NextResponse.json({ ok: true }, { status: 200 }),
    });
    const request = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test_123" },
    });
    await handleApiV1Route(request, { logContext: "api/v1/source-documents", handler });

    const context = handler.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(context.credential).toEqual(credential);
    expect(context.request).toBe(request);
    expect(context.requestId).toEqual(expect.any(String));
    expect("key" in context).toBe(false);
  });

  it("uses a hashed pre-auth bucket when the client IP is unknown", async () => {
    getClientIPFromHeadersMock.mockReturnValue("unknown");
    const handler = vi.fn().mockResolvedValue({
      response: NextResponse.json({ ok: true }, { status: 200 }),
    });
    const response = await handleApiV1Route(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: "Bearer sk_test_123" },
      }),
      { logContext: "api/v1/source-documents", handler }
    );

    expect(response.status).toBe(200);
    expect(rateLimiterMock.increment).toHaveBeenCalledTimes(2);
    expect(rateLimiterMock.increment.mock.calls[0]?.[0]).toMatch(/^rl_api_v1_preauth:/);
    expect(rateLimiterMock.increment.mock.calls[0]?.[0]).not.toContain("unknown");
    expect(rateLimiterMock.increment.mock.calls[1]?.[0]).toMatch(/^rl_valid_cred:/);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("applies pre-auth limiting to invalid bearer requests with an unknown IP", async () => {
    getClientIPFromHeadersMock.mockReturnValue("unknown");
    serviceCredentialsMock.authenticate.mockResolvedValue(null);
    const handler = vi.fn();
    const response = await handleApiV1Route(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: "Bearer sk_invalid" },
      }),
      { logContext: "api/v1/source-documents", handler }
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(serviceCredentialsMock.authenticate).toHaveBeenCalledTimes(1);
    expect(rateLimiterMock.increment).toHaveBeenCalledOnce();
    expect(rateLimiterMock.increment.mock.calls[0]?.[0]).toMatch(/^rl_api_v1_preauth:/);
    expect(rateLimiterMock.increment.mock.calls[0]?.[0]).not.toContain("unknown");
    expect(handler).not.toHaveBeenCalled();
  });
});
