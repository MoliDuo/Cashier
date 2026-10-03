import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports ok while the database answers", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports unavailable when the database does not", async () => {
    vi.spyOn(db, "execute").mockRejectedValue(new Error("connection refused"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
