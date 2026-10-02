import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { op, startOperationMock } = vi.hoisted(() => {
  const op = { succeed: vi.fn(), fail: vi.fn() };
  return { op, startOperationMock: vi.fn(() => op) };
});

vi.mock("@/lib/telemetry/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telemetry/client")>()),
  startOperation: startOperationMock,
}));

import { postLedgerQuery } from "@/lib/queries/post-ledger-query";

beforeEach(() => {
  startOperationMock.mockClear();
  op.succeed.mockClear();
  op.fail.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
describe("ledger query errors", () => {
  it.each([401, 403, 429, 503])(
    "preserves HTTP %s for auth and retry decisions",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
      await expect(postLedgerQuery("ledger")).rejects.toMatchObject({
        statusCode: status,
        code: "LEDGER_QUERY_FAILED",
      });
    }
  );
});

describe("ledger query timeout", () => {
  it("bounds every query with a fifteen-second abort signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "ledger" }));
    vi.stubGlobal("fetch", fetchMock);

    await postLedgerQuery("ledger");

    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: timeout.mock.results[0]?.value });
    timeout.mockRestore();
  });
});

describe("ledger query telemetry", () => {
  it("records a successful read as a query op", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: "ledger" })));

    await postLedgerQuery("entries", [{ search: "private text" }]);

    expect(startOperationMock).toHaveBeenCalledWith("query.entries");
    expect(op.succeed).toHaveBeenCalledTimes(1);
    expect(op.fail).not.toHaveBeenCalled();
  });

  it("records an HTTP failure by status, and a network failure by the error's type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(postLedgerQuery("ledger")).rejects.toThrow();
    expect(op.fail).toHaveBeenLastCalledWith("http_503");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(postLedgerQuery("ledger")).rejects.toThrow("Failed to fetch");
    expect(op.fail).toHaveBeenLastCalledWith("TypeError");
    expect(op.succeed).not.toHaveBeenCalled();
  });
});
