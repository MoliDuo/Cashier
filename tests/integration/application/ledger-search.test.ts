import { describe, expect, it } from "vitest";
import { postgresLedgerProjectionAdapter } from "@/application/adapters/postgres";
import { serverComposition } from "@/application/server-composition-root";
import { getStreamTotal as getStreamTotalUseCase } from "@/modules/source-document/application/queries/get-stream-total";
import { listStreamPage as listStreamPageUseCase } from "@/modules/source-document/application/queries/list-stream-page";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { getTestDb } from "../../setup";
import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { calculateLedgerStats } from "@/modules/ledger/server/stats";

const queryPorts = {
  documents: serverComposition.sourceDocumentReads,
  changes: serverComposition.ledgerChanges,
};
const listStreamPage = (ledgerId: string, input: Parameters<typeof listStreamPageUseCase>[1]) =>
  listStreamPageUseCase(ledgerId, input, queryPorts);
const getStreamTotal = (ledgerId: string, input: Parameters<typeof getStreamTotalUseCase>[1]) =>
  getStreamTotalUseCase(ledgerId, input, queryPorts.documents);

describe("ledger search", () => {
  it("normalizes search and keeps Stream and Details contracts independent", async () => {
    const { ledgerId } = await createTestUserWithLedger(getTestDb());
    await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
      ledgerId,
      title: "Coffee Receipt",
      entryDate: "2026-07-15",
      entries: [
        {
          categoryId: null,
          amount: "12.50",
          currency: "CNY",
          itemName: "Latte",
          description: "Morning special",
          convertedAmount: "12.50",
          exchangeRate: "1.000000",
        },
      ],
      bookId: await testBookId(getTestDb(), ledgerId),
    });
    await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
      ledgerId,
      title: "Literal % Store",
      entryDate: "2026-07-16",
      entries: [
        {
          categoryId: null,
          amount: "20.00",
          currency: "CNY",
          itemName: "Tea_100%",
          description: null,
          convertedAmount: "20.00",
          exchangeRate: "1.000000",
        },
      ],
      bookId: await testBookId(getTestDb(), ledgerId),
    });

    const titleMatch = await listStreamPage(ledgerId, { search: "  coffee   receipt ", limit: 20 });
    const entryMatch = await listStreamPage(ledgerId, { search: "MORNING", limit: 20 });
    const literalMatch = await listStreamPage(ledgerId, { search: "_100%", limit: 20 });
    expect(titleMatch.items).toEqual([]);
    expect(entryMatch.items.map((item) => item.title)).toEqual(["Coffee Receipt"]);
    expect(literalMatch.items.map((item) => item.title)).toEqual(["Literal % Store"]);

    const detailsByTitle = await listLedgerEntries(ledgerId, {
      search: "Coffee Receipt",
      limit: 20,
    });
    const detailsByDescription = await listLedgerEntries(ledgerId, {
      search: "morning",
      limit: 20,
    });
    expect(detailsByTitle.items).toHaveLength(0);
    expect(detailsByDescription.items.map((item) => item.itemName)).toEqual(["Latte"]);

    await expect(getStreamTotal(ledgerId, { search: "morning" })).resolves.toEqual({
      total: "12.5",
      unconvertedCount: 0,
    });
    const summary = await calculateLedgerStats(ledgerId, { search: "morning" });
    expect(summary.convertedTotal?.total).toBe("12.5");
  });
});
