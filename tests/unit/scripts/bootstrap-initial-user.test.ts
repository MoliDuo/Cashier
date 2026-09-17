import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../../scripts/bootstrap-couple.mjs";

const client = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), end: vi.fn() }));
const hash = vi.hoisted(() => vi.fn());
vi.mock("pg", () => ({
  default: {
    Client: class {
      constructor() {
        return client;
      }
    },
  },
}));
vi.mock("bcryptjs", () => ({ default: { hash, truncates: vi.fn(() => false) } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://fixture/fixture_test");
  vi.stubEnv("COUPLE_OWNER_USER_ID", "00000000-0000-4000-8000-000000000001");
  vi.stubEnv("COUPLE_PARTNER_USER_ID", "00000000-0000-4000-8000-000000000002");
  vi.stubEnv("COUPLE_LEDGER_ID", "00000000-0000-4000-8000-000000000003");
  vi.stubEnv("COUPLE_OWNER_EMAIL", "Fixture@Example.com");
  vi.stubEnv("COUPLE_PARTNER_EMAIL", "Partner@Example.com");
  vi.stubEnv("COUPLE_OWNER_PASSWORD", "fixture123");
  vi.stubEnv("COUPLE_PARTNER_PASSWORD", "partner123");
  client.query.mockResolvedValue({ rowCount: 0, rows: [{ users: 0, ledgers: 0 }] });
  hash.mockResolvedValue("hashed-password");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("couple bootstrap preview", () => {
  it("does not insert users on preview", async () => {
    await main();
    expect(hash).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO"),
      expect.anything()
    );
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.end).toHaveBeenCalledOnce();
  });

  it("rejects nonempty databases", async () => {
    client.query.mockResolvedValue({ rows: [{ users: 1, ledgers: 0 }] });
    await expect(main()).rejects.toThrow("empty user and ledger database");
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
  });

  it.each(["COUPLE_OWNER_EMAIL", "COUPLE_OWNER_PASSWORD"])(
    "rejects invalid %s before connecting",
    async (field) => {
      vi.stubEnv(field, "invalid");
      await expect(main()).rejects.toThrow(
        field === "COUPLE_OWNER_EMAIL" ? "ownerEmail" : "ownerPassword"
      );
      expect(client.connect).not.toHaveBeenCalled();
    }
  );

  it("rolls back a preview query failure", async () => {
    client.query.mockRejectedValueOnce(new Error("query failed"));
    await expect(main()).rejects.toThrow("query failed");
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.end).toHaveBeenCalledOnce();
  });
});
