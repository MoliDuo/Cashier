import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import proxy from "@/proxy";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";

function createRequest(path: string, sessionToken?: string, origin = "http://localhost:3000") {
  const headers = new Headers();
  if (sessionToken != null) headers.set("cookie", `${SESSION_COOKIE_NAME}=${sessionToken}`);
  return new NextRequest(new URL(path, origin), { headers });
}

describe("proxy", () => {
  describe("public routes", () => {
    it("lets public pages through without a session", () => {
      for (const path of ["/login", "/s/some-share-id"]) {
        expect(proxy(createRequest(path)).status).toBe(200);
      }
    });

    it("no longer has an /api/auth exemption", () => {
      expect(proxy(createRequest("/api/auth/session")).status).toBe(401);
    });
  });

  describe("retired locale prefixes", () => {
    // A bookmark or an installed shortcut from the bilingual era still points
    // at /zh/..., so the prefix is stripped rather than 404'd.
    it.each([
      ["/zh/login", "/login"],
      ["/en/ledgers/ledger-1", "/ledgers/ledger-1"],
      ["/zh", "/"],
    ])("redirects %s to %s", (from, to) => {
      const res = proxy(createRequest(from));

      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe(to);
    });

    it("leaves a path that merely starts with those letters alone", () => {
      expect(proxy(createRequest("/zhuanzhang")).status).toBe(200);
    });
  });

  describe("pages", () => {
    it("leaves page authorization to the protected layouts", () => {
      expect(proxy(createRequest("/dashboard")).status).toBe(200);
      expect(proxy(createRequest("/dashboard", "token")).status).toBe(200);
    });

    it("pushes the session cookie's expiry out on a page load", () => {
      const res = proxy(createRequest("/", "token", "https://cashier.example"));
      const cookie = res.cookies.get(SESSION_COOKIE_NAME);

      expect(cookie?.value).toBe("token");
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.secure).toBe(true);
      expect(cookie?.maxAge).toBe(14 * 24 * 60 * 60);
    });

    it("sets no cookie for a browser that has none", () => {
      expect(proxy(createRequest("/")).cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
    });
  });

  describe("API routes", () => {
    it("returns 401 without a session cookie", async () => {
      const res = proxy(createRequest("/api/protected"));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("lets a request with a session cookie through for the route to check", () => {
      expect(proxy(createRequest("/api/protected", "token")).status).toBe(200);
    });

    it("leaves the cron route and API v1 to authenticate themselves", () => {
      expect(proxy(createRequest("/api/cron/daily")).status).toBe(200);
      expect(proxy(createRequest("/api/v1/documents")).status).toBe(200);
    });

    it("does not treat a path that merely starts with cron as the cron route", () => {
      expect(proxy(createRequest("/api/cronjobs")).status).toBe(401);
    });

    it("does not let a dot bypass API authentication", () => {
      expect(proxy(createRequest("/api/private/file.json")).status).toBe(401);
    });
  });

  it("skips _next paths", () => {
    expect(proxy(createRequest("/_next/static/chunk.js")).status).toBe(200);
  });
});
