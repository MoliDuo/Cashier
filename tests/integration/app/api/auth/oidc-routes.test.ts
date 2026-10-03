import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestLedger } from "tests/helpers/schema-setup";
import { startOidcProviderForTests } from "tests/helpers/oidc-provider";
import { GET as login } from "@/app/api/auth/login/route";
import { GET as callback } from "@/app/auth/callback/route";
import { startSession } from "@/modules/auth/server/current-session";

const provider = startOidcProviderForTests();

beforeEach(() => vi.clearAllMocks());

function loginRequest(callbackUrl?: string) {
  const url = new URL("http://localhost:3000/api/auth/login");
  if (callbackUrl != null) url.searchParams.set("callbackUrl", callbackUrl);
  return new NextRequest(url);
}

function callbackRequest(query: URLSearchParams, flowCookie?: string) {
  const url = new URL(`http://localhost:3000/auth/callback?${query}`);
  return new NextRequest(url, {
    headers: flowCookie == null ? {} : { cookie: `cashier_oidc=${flowCookie}` },
  });
}

function cookieOf(response: Response, name: string) {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split("; ");
}

/** Runs the login route, lets the provider answer, and returns the callback request. */
async function comeBack(callbackUrl?: string) {
  const started = await login(loginRequest(callbackUrl));
  const flowCookie = cookieOf(started, "cashier_oidc")![0]!.slice("cashier_oidc=".length);
  const query = await provider.authorize(new URL(started.headers.get("location")!));
  return { query, flowCookie };
}

describe("GET /api/auth/login", () => {
  it("redirects to the provider and keeps the attempt in a short-lived cookie the page cannot read", async () => {
    const response = await login(loginRequest("/entries"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/authorize");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const attributes = cookieOf(response, "cashier_oidc")!
      .slice(1)
      .map((v) => v.toLowerCase());
    expect(attributes).toEqual(
      expect.arrayContaining(["path=/auth/callback", "httponly", "samesite=lax", "max-age=600"])
    );
    // APP_URL is http here, so the cookie may travel over http.
    expect(attributes).not.toContain("secure");
  });

  it("forgets that the reader just signed out, since signing in is what they asked for", async () => {
    const response = await login(loginRequest());

    const marker = cookieOf(response, "cashier_signed_out")!;
    expect(marker[0]).toBe("cashier_signed_out=");
    expect(marker.map((v) => v.toLowerCase())).toEqual(
      expect.arrayContaining(["path=/", "max-age=0"])
    );
  });

  it("lands on the error page instead of failing when the provider cannot be reached", async () => {
    const original = process.env.OIDC_ISSUER_URL;
    process.env.OIDC_ISSUER_URL = "http://127.0.0.1:1";
    try {
      const response = await login(loginRequest());

      expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=failed");
      expect(cookieOf(response, "cashier_oidc")).toBeUndefined();
    } finally {
      process.env.OIDC_ISSUER_URL = original;
    }
  });
});

describe("GET /auth/callback", () => {
  it("opens a session for the address the provider vouched for and goes where the visitor was headed", async () => {
    await createTestLedger(getTestDb());
    provider.signInAs({ email: "Me@Example.com" });
    const { query, flowCookie } = await comeBack("/entries?tab=all");

    const response = await callback(callbackRequest(query, flowCookie));

    expect(response.headers.get("location")).toBe("http://localhost:3000/entries?tab=all");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(startSession).toHaveBeenCalledExactlyOnceWith("Me@Example.com");
  });

  it("clears the attempt's cookie on the path it was set on, whatever the outcome", async () => {
    await createTestLedger(getTestDb());
    provider.signInAs({ email: "me@example.com" });
    const { query, flowCookie } = await comeBack();

    const response = await callback(callbackRequest(query, flowCookie));

    const cleared = cookieOf(response, "cashier_oidc")!;
    expect(cleared[0]).toBe("cashier_oidc=");
    expect(cleared.map((v) => v.toLowerCase())).toEqual(
      expect.arrayContaining(["path=/auth/callback", "max-age=0"])
    );
  });

  it("lets in any address the provider signs in, with no list of its own to check", async () => {
    await createTestLedger(getTestDb());
    provider.signInAs({ email: "stranger@example.com" });
    const { query, flowCookie } = await comeBack();

    const response = await callback(callbackRequest(query, flowCookie));

    expect(response.headers.get("location")).toBe("http://localhost:3000/");
    expect(startSession).toHaveBeenCalledExactlyOnceWith("stranger@example.com");
  });

  it("refuses to sign in before the ledger exists", async () => {
    provider.signInAs({ email: "me@example.com" });
    const { query, flowCookie } = await comeBack();

    const response = await callback(callbackRequest(query, flowCookie));

    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=failed");
    expect(startSession).not.toHaveBeenCalled();
  });

  it("tells a refusal at the provider from a failure", async () => {
    provider.signInAs(null);
    const refused = await comeBack();
    const denied = await callback(callbackRequest(refused.query, refused.flowCookie));
    const failed = await callback(callbackRequest(refused.query));

    expect(denied.headers.get("location")).toBe("http://localhost:3000/login?error=denied");
    expect(failed.headers.get("location")).toBe("http://localhost:3000/login?error=failed");
    expect(startSession).not.toHaveBeenCalled();
  });

  it("maps a failure after the provider answered to the error page", async () => {
    await createTestLedger(getTestDb());
    provider.signInAs({ email: "me@example.com" });
    const { query, flowCookie } = await comeBack();
    vi.mocked(startSession).mockRejectedValueOnce(new Error("database down"));

    const response = await callback(callbackRequest(query, flowCookie));

    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=failed");
  });

  it("builds the redirect from APP_URL, not from the request's host", async () => {
    await createTestLedger(getTestDb());
    provider.signInAs({ email: "me@example.com" });
    const { query, flowCookie } = await comeBack();
    const request = new NextRequest(`http://attacker.example/auth/callback?${query}`, {
      headers: { cookie: `cashier_oidc=${flowCookie}`, host: "attacker.example" },
    });

    const response = await callback(request);

    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
});
