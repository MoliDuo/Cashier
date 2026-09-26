import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { ledgers, rateLimitBuckets, serviceCredentials } from "@/persistence";
import { computeHash, prefixSuffix } from "@/lib/security/service-credential-token";
import { rateLimitKey } from "@/lib/rate-limit";
import { handleApiV1Route } from "@/server/api-v1/request-pipeline";

// Every window opened by these tests starts at this minute, so a pre-filled
// bucket and the pipeline's own increment land in the same window.
const NOW = new Date("2026-05-01T10:00:30Z");
const WINDOW_START = new Date("2026-05-01T10:00:00Z");
const WINDOW_RESET_SECONDS = String(Date.parse("2026-05-01T10:01:00Z") / 1000);

describe("handleApiV1Route", () => {
  let credentialId = "";
  let credentialKey = "";
  const handler = vi.fn();

  function call(authorization?: string) {
    const headers = new Headers();
    if (authorization !== undefined) headers.set("Authorization", authorization);
    return handleApiV1Route(new NextRequest("http://localhost/api/v1/probe", { headers }), {
      logContext: "probe",
      handler,
    });
  }

  async function fillBucket(bucketKey: string, count: number) {
    await getTestDb()
      .insert(rateLimitBuckets)
      .values({ bucketKey, count, windowStart: WINDOW_START });
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    handler.mockReset();
    handler.mockResolvedValue({ response: NextResponse.json({ ok: true }) });

    const db = getTestDb();
    await db.delete(ledgers);
    const { ledgerId } = await createTestUserWithLedger(db);
    credentialKey = `sk_pipeline_${crypto.randomUUID().replace(/-/g, "")}`;
    const { prefix, suffix } = prefixSuffix(credentialKey);
    const [credential] = await db
      .insert(serviceCredentials)
      .values({
        ledgerId,
        name: "Pipeline Credential",
        tokenHash: computeHash(credentialKey),
        bookId: await testBookId(db, ledgerId),
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning({ id: serviceCredentials.id });
    credentialId = credential!.id;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("challenges a request without a usable bearer key", async () => {
    for (const authorization of [undefined, "Bearer", "Bearer a b", "Bearer sk_unknown"]) {
      const response = await call(authorization);
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("X-Request-Id")).toBeTruthy();
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts the scheme in any letter case and hands the handler the credential", async () => {
    for (const scheme of ["bearer", "BEARER"]) {
      await expect(call(`${scheme} ${credentialKey}`)).resolves.toMatchObject({ status: 200 });
    }

    expect(handler).toHaveBeenCalledTimes(2);
    const context = handler.mock.calls[0]?.[0];
    expect(context.credential).toMatchObject({ id: credentialId });
    expect(context.credential).not.toHaveProperty("tokenHash");
    expect(context.requestId).toEqual(expect.any(String));
  });

  it("stamps the credential's quota and a request id on a successful response", async () => {
    const response = await call(`Bearer ${credentialKey}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("59");
    expect(response.headers.get("X-RateLimit-Reset")).toBe(WINDOW_RESET_SECONDS);
    expect(response.headers.get("X-Request-Id")).toBe(handler.mock.calls[0]?.[0].requestId);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("stops unauthenticated floods before any key is looked at", async () => {
    // Without a trusted proxy every caller shares the one "unknown" address.
    await fillBucket(rateLimitKey("api-v1:preauth", "unknown"), 120);

    const response = await call(`Bearer ${credentialKey}`);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("120");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a credential over its per-minute quota", async () => {
    await fillBucket(rateLimitKey("api-v1:credential", credentialId), 60);

    const response = await call(`Bearer ${credentialKey}`);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(response.headers.get("X-RateLimit-Reset")).toBe(WINDOW_RESET_SECONDS);
    expect(handler).not.toHaveBeenCalled();
  });
});
