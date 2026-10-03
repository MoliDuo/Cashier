import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET } from "@/app/healthz/route";

describe("GET /healthz", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports ok and the build version while the database answers", async () => {
    vi.stubEnv("APP_VERSION", "0123456789abcdef0123456789abcdef01234567");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      version: "0123456789abcdef0123456789abcdef01234567",
    });
  });

  it("reports dev outside a deploy build", async () => {
    vi.stubEnv("APP_VERSION", "");

    expect(await (await GET()).json()).toEqual({ ok: true, version: "dev" });
  });

  it("reports not ok when the database does not answer", async () => {
    vi.spyOn(db, "execute").mockRejectedValue(new Error("connection refused"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
  });
});
