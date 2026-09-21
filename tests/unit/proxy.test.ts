import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("next-auth", () => ({
  default: () => ({
    auth: (
      cb: (req: NextRequest & { auth: unknown }) => Promise<Response | void> | Response | void
    ) => cb,
  }),
}));

vi.mock("../../src/auth.config", () => ({
  authConfig: {},
}));

import proxy from "@/proxy";

describe("Proxy Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createRequest(path: string, auth: unknown = null) {
    const url = new URL(path, "http://localhost:3000");
    const req = new NextRequest(url) as NextRequest & { auth?: unknown };
    req.auth = auth;
    return req;
  }

  const invokeProxy = (req: NextRequest) =>
    (proxy as unknown as (req: NextRequest) => Promise<NextResponse>)(req);

  describe("Public Routes", () => {
    it("lets public pages through without authentication", async () => {
      for (const path of ["/login", "/s/some-share-id"]) {
        expect((await invokeProxy(createRequest(path))).status).toBe(200);
      }
    });

    it("should allow access to /api/auth/* without authentication", async () => {
      const req = createRequest("/api/auth/session");
      const res = await invokeProxy(req);
      expect(res.status).toBe(200);
    });
  });

  describe("Retired locale prefixes", () => {
    // A bookmark or an installed shortcut from the bilingual era still points
    // at /zh/..., so the prefix is stripped rather than 404'd.
    it.each([
      ["/zh/login", "/login"],
      ["/en/ledgers/ledger-1", "/ledgers/ledger-1"],
      ["/zh", "/"],
    ])("redirects %s to %s", async (from, to) => {
      const res = await invokeProxy(createRequest(from));

      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe(to);
    });

    it("leaves a path that merely starts with those letters alone", async () => {
      expect((await invokeProxy(createRequest("/zhuanzhang"))).status).toBe(200);
    });
  });

  describe("Protected Page Routes", () => {
    it("leaves page authorization to the protected layouts", async () => {
      for (const request of [
        createRequest("/dashboard"),
        createRequest("/dashboard", { user: { id: "user1" } }),
      ]) {
        expect((await invokeProxy(request)).status).toBe(200);
      }
    });
  });

  describe("Protected API Routes", () => {
    it.each(["/api/auth-admin", "/api/authentication"])(
      "does not treat %s as an Auth.js endpoint",
      async (path) => {
        const res = await invokeProxy(createRequest(path));
        expect(res.status).toBe(401);
      }
    );

    it("should return 401 for unauthenticated access to /api/protected", async () => {
      const req = createRequest("/api/protected");
      const res = await invokeProxy(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toEqual({ error: "Unauthorized" });
    });

    it("should allow authenticated access to /api/protected", async () => {
      const req = createRequest("/api/protected", { user: { id: "user1" } });
      const res = await invokeProxy(req);

      expect(res.status).toBe(200);
    });

    it("does not let a dot bypass API authentication", async () => {
      const res = await invokeProxy(createRequest("/api/private/file.json"));
      expect(res.status).toBe(401);
    });
  });

  describe("Static Assets", () => {
    it("should skip proxy for _next paths", async () => {
      const req = createRequest("/_next/static/chunk.js");
      const res = await invokeProxy(req);
      expect(res.status).toBe(200);
    });
  });
});
