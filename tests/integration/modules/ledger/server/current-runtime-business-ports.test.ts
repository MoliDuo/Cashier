import { describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import { listCategories } from "@/modules/ledger/server/categories";
import { getLedger } from "@/modules/ledger/server/live-ledger";
import { authenticateServiceCredential } from "@/modules/ledger/server/service-credentials";
import { getLedgerSettings } from "@/modules/ledger/server/settings";
import { entryCategories, ledgers, serviceCredentials } from "@/persistence";
import { computeHash } from "@/lib/security/service-credential-token";
import { insertExchangeRates } from "tests/helpers/exchange-rates";

describe("current-runtime target adapters", () => {
  it("implements ledger, category, currency, settings, auth, and credential ports", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const bookId = await testBookId(db);
    await db.update(ledgers).set({ mainCurrency: "CNY" });
    await db.insert(entryCategories).values({ name: "Food" });
    await insertExchangeRates("2026-07-15", { CNY: 8, USD: 2 });
    const credentialId = crypto.randomUUID();
    await db.insert(serviceCredentials).values({
      id: credentialId,
      tokenHash: computeHash("secret-key"),
      bookId: bookId,
      tokenPrefix: "secret-k",
      tokenSuffix: "-key",
      name: "API",
    });

    await expect(getLedger()).resolves.toMatchObject({
      settings: { mainCurrency: "CNY" },
    });
    await expect(listCategories()).resolves.toHaveLength(1);
    await expect(getLedgerSettings()).resolves.toMatchObject({
      mainCurrency: "CNY",
    });
    await expect(authenticateServiceCredential("secret-key")).resolves.toEqual({
      id: credentialId,
      bookId: bookId,
    });
  });
});
