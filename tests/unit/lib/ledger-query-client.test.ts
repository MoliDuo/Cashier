import { afterEach, describe, expect, it, vi } from "vitest";
import { getLedgerAction } from "@/lib/queries/ledger-query-client";

afterEach(() => vi.unstubAllGlobals());
describe("ledger query errors", () => {
  it.each([401, 403, 429, 503])(
    "preserves HTTP %s for auth and retry decisions",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
      await expect(getLedgerAction("ledger")).rejects.toMatchObject({
        statusCode: status,
        code: "LEDGER_QUERY_FAILED",
      });
    }
  );
});
