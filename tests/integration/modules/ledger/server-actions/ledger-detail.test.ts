import { describe, it, expect } from "vitest";
import { getLedgerAction } from "@/modules/ledger/server/get-ledger";
import { updateLedgerSettingsAction } from "@/modules/ledger/server-actions/update";
import { getTestDb } from "tests/setup";
import { ledgers } from "@/persistence";
import { createTestUserWithLedger, TEST_USER_ID } from "tests/helpers/schema-setup";
import { eq } from "drizzle-orm";
import { NotFoundError } from "@/lib/errors";
import { insertExchangeRates } from "tests/helpers/exchange-rates";

// Helper to clean up and create test ledger for current user
async function setupTestLedger(db: ReturnType<typeof getTestDb>) {
  await db.delete(ledgers);
  const { ledgerId } = await createTestUserWithLedger(db, undefined, undefined, TEST_USER_ID);
  return ledgerId;
}

describe("Ledger Actions", () => {
  it("rejects when the account has no live ledger (Get)", async () => {
    await expect(getLedgerAction()).rejects.toBeInstanceOf(NotFoundError);
  });

  it("should update ledger settings", async () => {
    const db = getTestDb();
    const ledgerId = await setupTestLedger(db);
    const initial = await db.query.ledgers.findFirst({ where: eq(ledgers.id, ledgerId) });
    await insertExchangeRates("2026-08-22", { USD: 1, CNY: 8 });

    const result = await updateLedgerSettingsAction({
      expectedUpdatedAt: initial!.updatedAt.toISOString(),
      settings: {
        mainCurrency: "USD",
        aiLanguage: "en",
        currencies: ["USD", "CNY"],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.settings.mainCurrency).toBe("USD");
    expect(result.ledger.settings.aiLanguage).toBe("en");
    expect(result.ledger.settings.currencies).toEqual(["USD", "CNY"]);
  });

  it("rejects when the account has no live ledger (Update)", async () => {
    await expect(
      updateLedgerSettingsAction({
        expectedUpdatedAt: new Date().toISOString(),
        settings: { mainCurrency: "USD" },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
