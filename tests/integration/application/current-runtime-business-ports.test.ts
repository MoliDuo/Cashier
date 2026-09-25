import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { listCategories } from "@/modules/ledger/server/categories";
import { getLiveLedger } from "@/modules/ledger/server/live-ledger";
import { authenticateServiceCredential } from "@/modules/ledger/server/service-credentials";
import { getLedgerSettings } from "@/modules/ledger/server/settings";
import { entryCategories, ledgers, serviceCredentials } from "@/persistence";
import { computeHash } from "@/lib/security/service-credential-token";
import { insertExchangeRates } from "../../helpers/exchange-rates";

describe("current-runtime target adapters", () => {
  it("implements ledger, category, currency, settings, auth, and credential ports", async () => {
    const db = getTestDb();
    const { userId, ledgerId } = await createTestUserWithLedger(db);
    const bookId = await testBookId(db, ledgerId);
    await db.update(ledgers).set({ mainCurrency: "CNY" }).where(eq(ledgers.id, ledgerId));
    await db.insert(entryCategories).values({ ledgerId, name: "Food" });
    await insertExchangeRates("2026-07-15", { CNY: 8, USD: 2 });
    const credentialId = crypto.randomUUID();
    await db.insert(serviceCredentials).values({
      id: credentialId,
      ledgerId,
      tokenHash: computeHash("secret-key"),
      bookId: bookId,
      tokenPrefix: "secret-k",
      tokenSuffix: "-key",
      name: "API",
    });

    await expect(getLiveLedger(userId)).resolves.toMatchObject({
      id: ledgerId,
    });
    await expect(listCategories(ledgerId)).resolves.toHaveLength(1);
    await expect(getLedgerSettings(ledgerId)).resolves.toMatchObject({
      mainCurrency: "CNY",
    });
    await expect(authenticateServiceCredential("secret-key")).resolves.toEqual({
      id: credentialId,
      ledgerId,
      bookId: bookId,
    });
  });
});
