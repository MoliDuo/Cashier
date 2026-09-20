import { describe, it, expect } from "vitest";
import { getLedgerAction } from "@/modules/ledger/server/get-ledger";
import { updateLedgerSettingsAction } from "@/modules/ledger/server-actions/update";
import { getTestDb } from "../../setup";
import { currencyRates, ledgers } from "@/persistence";
import { createTestUserWithLedger, TEST_USER_ID } from "../../helpers/schema-setup";
import { eq } from "drizzle-orm";

// Helper to clean up and create test ledger for current user
async function setupTestLedger(db: ReturnType<typeof getTestDb>) {
  await db.delete(ledgers).where(eq(ledgers.userId, TEST_USER_ID));
  const { ledgerId } = await createTestUserWithLedger(db, undefined, undefined, TEST_USER_ID);
  return ledgerId;
}

describe("Ledger Actions", () => {
  it("should return null for non-existent ledger (Get)", async () => {
    const result = await getLedgerAction("00000000-0000-4000-8000-000000000000");
    expect(result).toBeNull();
  });

  it("should update ledger settings", async () => {
    const db = getTestDb();
    const ledgerId = await setupTestLedger(db);
    const initial = await db.query.ledgers.findFirst({ where: eq(ledgers.id, ledgerId) });
    await db.insert(currencyRates).values({
      date: "2026-08-22",
      base: "EUR",
      rates: { USD: 1, CNY: 8 },
    });

    const result = await updateLedgerSettingsAction(ledgerId, {
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

  it("should return a stable conflict for a non-existent ledger (Update)", async () => {
    await expect(
      updateLedgerSettingsAction("00000000-0000-4000-8000-000000000000", {
        expectedUpdatedAt: new Date().toISOString(),
        settings: { mainCurrency: "USD" },
      })
    ).resolves.toEqual({ ok: false, code: "conflict" });
  });
});
