import { afterEach, describe, expect, it, vi } from "vitest";
import { postLedgerQuery } from "@/lib/queries/post-ledger-query";

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
