import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger } from "../../helpers/schema-setup";
import {
  postgresCategoryAdapter,
  postgresCurrencyAdapter,
  postgresLedgerAdapter,
  postgresServiceCredentialAdapter,
  postgresSettingsAdapter,
} from "@/application/adapters/postgres";
import { currencyRates, entryCategories, ledgers, serviceCredentials } from "@/persistence";
import { computeHash } from "@/lib/security/service-credential-token";

describe("current-runtime target adapters", () => {
  it("implements ledger, category, currency, settings, auth, and credential ports", async () => {
    const db = getTestDb();
    const { userId, ledgerId } = await createTestUserWithLedger(db);
    await db.update(ledgers).set({ mainCurrency: "CNY" }).where(eq(ledgers.id, ledgerId));
    await db.insert(entryCategories).values({ ledgerId, name: "Food" });
    await db.insert(currencyRates).values({
      date: "2026-07-15",
      base: "EUR",
      rates: { CNY: 8, USD: 2 },
    });
    const credentialId = crypto.randomUUID();
    await db.insert(serviceCredentials).values({
      id: credentialId,
      ledgerId,
      tokenHash: computeHash("secret-key"),
      attributedUserId: userId,
      tokenPrefix: "secret-k",
      tokenSuffix: "-key",
      name: "API",
    });

    await expect(postgresLedgerAdapter.canAccess(ledgerId, userId)).resolves.toBe(true);
    await expect(postgresCategoryAdapter.list(ledgerId)).resolves.toHaveLength(1);
    await expect(postgresSettingsAdapter.get(ledgerId)).resolves.toMatchObject({
      mainCurrency: "CNY",
    });
    await expect(postgresCurrencyAdapter.convert("16", "CNY", "USD")).resolves.toBe("4.00");
    await expect(postgresServiceCredentialAdapter.authenticate("secret-key")).resolves.toEqual({
      id: credentialId,
      ledgerId,
      attributedUserId: userId,
    });
  });
});
