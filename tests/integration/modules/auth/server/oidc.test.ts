import { describe, expect, it } from "vitest";
import { startOidcProviderForTests } from "tests/helpers/oidc-provider";
import { completeOidcLogin, startOidcLogin } from "@/modules/auth/server/oidc";

const provider = startOidcProviderForTests();

/** One full trip: start, the provider answers, the browser comes back. */
async function trip(callbackPath: string | null = "/entries") {
  const { authorizationUrl, flowCookie } = await startOidcLogin(callbackPath);
  const query = await provider.authorize(authorizationUrl);
  return { authorizationUrl, flowCookie, query };
}

describe("OIDC sign-in", () => {
  it("asks the provider for a code with PKCE, state and nonce, and sends it back to the app", async () => {
    const { authorizationUrl } = await startOidcLogin("/entries");

    expect(authorizationUrl.pathname).toBe("/authorize");
    const params = authorizationUrl.searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("cashier-test");
    expect(params.get("scope")).toBe("openid email");
    expect(params.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback");
    expect(params.get("code_challenge_method")).toBe("S256");
    for (const name of ["state", "nonce", "code_challenge"]) {
      expect(params.get(name)).toMatch(/^[\w-]{20,}$/);
    }
  });

  it("starts a different attempt every time", async () => {
    const first = await startOidcLogin("/");
    const second = await startOidcLogin("/");

    expect(first.flowCookie).not.toBe(second.flowCookie);
    expect(first.authorizationUrl.searchParams.get("state")).not.toBe(
      second.authorizationUrl.searchParams.get("state")
    );
  });

  it("returns the address the provider vouches for and where the visitor was headed", async () => {
    provider.signInAs({ email: "me@example.com" });
    const { flowCookie, query } = await trip("/entries?tab=all");

    await expect(completeOidcLogin({ query, flowCookie })).resolves.toEqual({
      status: "authenticated",
      email: "me@example.com",
      callbackPath: "/entries?tab=all",
    });
  });

  it("reads the address from userinfo when the ID token leaves it out", async () => {
    provider.signInAs({ email: "me@example.com", emailInIdToken: false });
    const { flowCookie, query } = await trip();

    await expect(completeOidcLogin({ query, flowCookie })).resolves.toMatchObject({
      status: "authenticated",
      email: "me@example.com",
    });
  });

  it("accepts an address the provider marks verified, and refuses one it marks unverified", async () => {
    provider.signInAs({ email: "me@example.com", emailVerified: true });
    const verified = await trip();
    await expect(
      completeOidcLogin({ query: verified.query, flowCookie: verified.flowCookie })
    ).resolves.toMatchObject({ status: "authenticated" });

    for (const emailInIdToken of [true, false]) {
      provider.signInAs({ email: "me@example.com", emailVerified: false, emailInIdToken });
      const unverified = await trip();
      await expect(
        completeOidcLogin({ query: unverified.query, flowCookie: unverified.flowCookie })
      ).resolves.toEqual({ status: "failed" });
    }
  });

  it("falls back to the front page for a callback path that leaves the site", async () => {
    provider.signInAs({ email: "me@example.com" });
    for (const hostile of ["https://evil.example", "//evil.example", "/\\evil.example", null]) {
      const { flowCookie, query } = await trip(hostile);

      await expect(completeOidcLogin({ query, flowCookie })).resolves.toMatchObject({
        status: "authenticated",
        callbackPath: "/",
      });
    }
  });

  it("reports a refusal at the provider as denied, and does not ask it for a token", async () => {
    provider.signInAs(null);
    const { flowCookie, query } = await trip();

    expect(query.get("error")).toBe("access_denied");
    await expect(completeOidcLogin({ query, flowCookie })).resolves.toEqual({ status: "denied" });
  });

  it("refuses a response that arrives without the attempt's cookie", async () => {
    provider.signInAs({ email: "me@example.com" });
    const { query } = await trip();

    await expect(completeOidcLogin({ query, flowCookie: undefined })).resolves.toEqual({
      status: "failed",
    });
  });

  it("refuses a cookie that was altered, signed for something else or cut short", async () => {
    provider.signInAs({ email: "me@example.com" });
    const { flowCookie, query } = await trip();
    const other = await startOidcLogin("/");
    const [payload, signature] = flowCookie.split(".");
    const [otherPayload] = other.flowCookie.split(".");

    for (const forged of [
      `${otherPayload}.${signature}`,
      `${payload}.${"0".repeat(signature!.length)}`,
      `${payload}x.${signature}`,
      payload!,
      `${flowCookie}.extra`,
      "",
    ]) {
      await expect(completeOidcLogin({ query, flowCookie: forged })).resolves.toEqual({
        status: "failed",
      });
    }
  });

  it("refuses a response whose state is not the one the attempt sent", async () => {
    provider.signInAs({ email: "me@example.com" });
    const { flowCookie, query } = await trip();
    const swapped = new URLSearchParams(query);
    swapped.set("state", "someone-elses-state");

    await expect(completeOidcLogin({ query: swapped, flowCookie })).resolves.toEqual({
      status: "failed",
    });
  });

  it("refuses an attempt that outlived its ten minutes", async () => {
    provider.signInAs({ email: "me@example.com" });
    const { flowCookie, query } = await trip();

    await expect(
      completeOidcLogin({ query, flowCookie, now: Date.now() + 11 * 60 * 1000 })
    ).resolves.toEqual({ status: "failed" });
  });

  it("accepts a response only once", async () => {
    provider.signInAs({ email: "me@example.com" });
    const { flowCookie, query } = await trip();

    await expect(completeOidcLogin({ query, flowCookie })).resolves.toMatchObject({
      status: "authenticated",
    });
    await expect(completeOidcLogin({ query, flowCookie })).resolves.toEqual({ status: "failed" });
  });

  it("refuses an ID token signed for another nonce", async () => {
    provider.signInAs({ email: "me@example.com", wrongNonce: true });
    const { flowCookie, query } = await trip();

    await expect(completeOidcLogin({ query, flowCookie })).resolves.toEqual({ status: "failed" });
  });

  it("refuses a code that another attempt's verifier cannot redeem", async () => {
    provider.signInAs({ email: "me@example.com" });
    const stolen = await trip();
    const mine = await startOidcLogin("/");
    // The code and state are the thief's; the cookie, and so the verifier, is not.
    const query = new URLSearchParams(stolen.query);
    query.set("state", mine.authorizationUrl.searchParams.get("state")!);

    await expect(completeOidcLogin({ query, flowCookie: mine.flowCookie })).resolves.toEqual({
      status: "failed",
    });
  });
});
