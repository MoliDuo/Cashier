import { sql } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getTestDb, getTestPool } from "tests/setup";
import { createTestSourceDocument, createTestUser, TEST_USER_ID } from "tests/helpers/schema-setup";
import { calculateLedgerEntryStats } from "@/application/adapters/postgres/ledger-reads/calculate-ledger-entry-stats";
import { listLedgerEntryPage } from "@/application/adapters/postgres/ledger-reads/list-ledger-entry-page";
import { postgresServiceCredentialAdapter } from "@/application/adapters/postgres/business-ports/service-credentials";
import { computeHash } from "@/lib/security/service-credential-token";
import {
  currencyRates,
  entryCategories,
  ledgerEntries,
  ledgers,
  revisionFiles,
  serviceCredentials,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";

const script = resolve("scripts/migrate-couple-ledger.ts");

async function fixture(differentCurrency = false) {
  const db = getTestDb();
  const ownerId = TEST_USER_ID;
  const partnerId = crypto.randomUUID();
  await createTestUser(db, undefined, partnerId);
  const ownerLedgerId = crypto.randomUUID();
  const partnerLedgerId = crypto.randomUUID();
  await db.insert(ledgers).values([
    { id: ownerLedgerId, userId: ownerId, mainCurrency: "USD" },
    { id: partnerLedgerId, userId: partnerId, mainCurrency: differentCurrency ? "CNY" : "USD" },
  ]);
  const ownerCategory = crypto.randomUUID();
  const partnerCategory = crypto.randomUUID();
  await db.insert(entryCategories).values([
    { id: ownerCategory, ledgerId: ownerLedgerId, name: "Shared", sortOrder: 1 },
    { id: partnerCategory, ledgerId: partnerLedgerId, name: "Shared", sortOrder: 1 },
  ]);
  const ownerCredentialId = crypto.randomUUID();
  const partnerCredentialId = crypto.randomUUID();
  const revokedCredentialId = crypto.randomUUID();
  const revokedAt = new Date("2026-01-05T00:00:00.000Z");
  await db.insert(serviceCredentials).values([
    {
      id: ownerCredentialId,
      ledgerId: ownerLedgerId,
      name: "owner key",
      tokenHash: computeHash("sk_test_owner_old_key"),
      tokenPrefix: "sk_owner",
      tokenSuffix: "owner",
      attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${ownerLedgerId})`,
    },
    {
      id: partnerCredentialId,
      ledgerId: partnerLedgerId,
      name: "partner key",
      tokenHash: computeHash("sk_test_partner_old_key"),
      tokenPrefix: "sk_partner",
      tokenSuffix: "partner",
      attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${partnerLedgerId})`,
    },
    {
      id: revokedCredentialId,
      ledgerId: partnerLedgerId,
      name: "revoked partner key",
      tokenHash: computeHash("sk_test_revoked_old_key"),
      tokenPrefix: "sk_revoked",
      tokenSuffix: "revoked",
      deletedAt: revokedAt,
      attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${partnerLedgerId})`,
    },
  ]);
  const documentId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  await db.insert(sourceDocuments).values({
    id: documentId,
    ledgerId: partnerLedgerId,
    documentDate: "2026-01-04",
    attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${partnerLedgerId})`,
  });
  await db.insert(sourceDocumentRevisions).values({
    id: revisionId,
    ledgerId: partnerLedgerId,
    sourceDocumentId: documentId,
    revisionNumber: 1,
  });
  await db
    .update(sourceDocuments)
    .set({ activeRevisionId: revisionId, latestSubmissionRevisionId: revisionId })
    .where(eq(sourceDocuments.id, documentId));
  await db.insert(ledgerEntries).values({
    ledgerId: partnerLedgerId,
    sourceDocumentId: documentId,
    sourceDocumentRevisionId: revisionId,
    categoryId: partnerCategory,
    amount: "10",
    currency: differentCurrency ? "CNY" : "USD",
    convertedAmount: "10",
    exchangeRate: "1",
    itemName: "fixture",
  });
  await db.insert(storedFiles).values({
    id: fileId,
    ledgerId: partnerLedgerId,
    storageProvider: "s3",
    storageKey: crypto.randomUUID(),
    contentType: "image/jpeg",
    byteSize: 8,
  });
  await db
    .insert(revisionFiles)
    .values({ ledgerId: partnerLedgerId, revisionId, storedFileId: fileId, position: 0 });
  const schema = (
    await getTestPool().query<{ schema: string }>("SELECT current_schema() AS schema")
  ).rows[0]!.schema;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    COUPLE_OWNER_USER_ID: ownerId,
    COUPLE_PARTNER_USER_ID: partnerId,
  };
  const run = (apply = false) =>
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", script, ...(apply ? ["--apply"] : [])],
      {
        cwd: process.cwd(),
        env,
        timeout: 60_000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  return {
    run,
    ownerId,
    partnerId,
    ownerLedgerId,
    partnerLedgerId,
    ownerCategory,
    partnerCategory,
    ownerCredentialId,
    partnerCredentialId,
    revokedCredentialId,
    revokedAt,
    documentId,
    revisionId,
    fileId,
  };
}

describe("couple ledger migration", () => {
  it("previews without writes, then moves documents, revisions, files and ownership atomically", async () => {
    const data = await fixture();
    expect(JSON.parse(data.run())).toMatchObject({ categoryConflictCount: 1, mode: "preview" });
    expect((await getTestDb().select().from(sourceDocuments))[0]?.ledgerId).toBe(
      data.partnerLedgerId
    );
    data.run(true);
    expect((await getTestDb().select().from(sourceDocuments))[0]).toMatchObject({
      ledgerId: data.ownerLedgerId,
      attributedUserId: data.partnerId,
      createdByUserId: null,
    });
    expect((await getTestDb().select().from(ledgerEntries))[0]).toMatchObject({
      ledgerId: data.ownerLedgerId,
      categoryId: data.ownerCategory,
    });
    expect((await getTestDb().select().from(sourceDocumentRevisions))[0]?.ledgerId).toBe(
      data.ownerLedgerId
    );
    expect((await getTestDb().select().from(revisionFiles))[0]?.ledgerId).toBe(data.ownerLedgerId);
    expect((await getTestDb().select().from(storedFiles))[0]?.ledgerId).toBe(data.ownerLedgerId);
    const credentials = await getTestDb().select().from(serviceCredentials);
    expect(credentials).toHaveLength(3);
    expect(credentials.find((row) => row.id === data.ownerCredentialId)).toMatchObject({
      ledgerId: data.ownerLedgerId,
      attributedUserId: data.ownerId,
      tokenHash: computeHash("sk_test_owner_old_key"),
      deletedAt: null,
    });
    expect(credentials.find((row) => row.id === data.partnerCredentialId)).toMatchObject({
      ledgerId: data.ownerLedgerId,
      attributedUserId: data.partnerId,
      tokenHash: computeHash("sk_test_partner_old_key"),
      deletedAt: null,
    });
    expect(credentials.find((row) => row.id === data.revokedCredentialId)).toMatchObject({
      ledgerId: data.ownerLedgerId,
      attributedUserId: data.partnerId,
      tokenHash: computeHash("sk_test_revoked_old_key"),
      deletedAt: data.revokedAt,
    });
    expect(() => data.run(true)).toThrow();
    expect(await getTestDb().select().from(sourceDocuments)).toHaveLength(1);
  });

  it("authenticates both old member keys after migration but rejects revoked and third-party keys", async () => {
    const data = await fixture();
    const otherId = crypto.randomUUID();
    const otherLedgerId = crypto.randomUUID();
    await createTestUser(getTestDb(), undefined, otherId);
    await getTestDb().insert(ledgers).values({ id: otherLedgerId, userId: otherId });
    await getTestDb()
      .insert(serviceCredentials)
      .values({
        ledgerId: otherLedgerId,
        name: "other key",
        tokenHash: computeHash("sk_test_other_old_key"),
        tokenPrefix: "sk_other",
        tokenSuffix: "other",
        attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${otherLedgerId})`,
      });
    data.run(true);
    process.env.COUPLE_OWNER_USER_ID = data.ownerId;
    process.env.COUPLE_PARTNER_USER_ID = data.partnerId;
    process.env.COUPLE_LEDGER_ID = data.ownerLedgerId;
    await expect(
      postgresServiceCredentialAdapter.authenticate("sk_test_owner_old_key")
    ).resolves.toMatchObject({
      ledgerId: data.ownerLedgerId,
      attributedUserId: data.ownerId,
    });
    await expect(
      postgresServiceCredentialAdapter.authenticate("sk_test_partner_old_key")
    ).resolves.toMatchObject({
      ledgerId: data.ownerLedgerId,
      attributedUserId: data.partnerId,
    });
    await expect(
      postgresServiceCredentialAdapter.authenticate("sk_test_revoked_old_key")
    ).resolves.toBeNull();
    await expect(
      postgresServiceCredentialAdapter.authenticate("sk_test_other_old_key")
    ).resolves.toBeNull();
  });

  it("keeps same-name categories with different attributes and their entry references", async () => {
    const data = await fixture();
    await getTestDb()
      .update(entryCategories)
      .set({ description: "partner category" })
      .where(eq(entryCategories.id, data.partnerCategory));
    data.run(true);
    const category = (await getTestDb().select().from(entryCategories)).find(
      (row) => row.id === data.partnerCategory
    );
    expect(category).toMatchObject({
      ledgerId: data.ownerLedgerId,
      description: "partner category",
      deletedAt: null,
    });
    expect(category?.name).toBe(`Shared (migrated ${data.partnerCategory.slice(0, 8)})`);
    expect((await getTestDb().select().from(ledgerEntries))[0]?.categoryId).toBe(
      data.partnerCategory
    );
  });

  it("rolls back all changes if the new currency lacks a dated exchange rate", async () => {
    const data = await fixture(true);
    expect(() => data.run(true)).toThrow();
    expect((await getTestDb().select().from(sourceDocuments))[0]?.ledgerId).toBe(
      data.partnerLedgerId
    );
    await getTestDb()
      .insert(currencyRates)
      .values({ date: "2026-01-04", base: "USD", rates: { CNY: 7 } });
    data.run(true);
    expect((await getTestDb().select().from(ledgerEntries))[0]).toMatchObject({
      convertedAmount: "1.430",
      exchangeRate: "0.142857142857",
    });
  });

  it("filters detail pages and summaries by stable member ID after migration", async () => {
    const data = await fixture();
    data.run(true);
    const ownerDocumentId = await createTestSourceDocument(getTestDb(), data.ownerLedgerId);
    await getTestDb()
      .insert(ledgerEntries)
      .values({
        ledgerId: data.ownerLedgerId,
        sourceDocumentId: ownerDocumentId,
        sourceDocumentRevisionId: (
          await getTestDb()
            .select()
            .from(sourceDocuments)
            .where(eq(sourceDocuments.id, ownerDocumentId))
        )[0]!.activeRevisionId,
        amount: "20",
        currency: "USD",
        convertedAmount: "20",
        exchangeRate: "1",
        itemName: "owner",
      });
    await getTestDb()
      .update(sourceDocuments)
      .set({ attributedUserId: data.ownerId })
      .where(eq(sourceDocuments.id, ownerDocumentId));
    const all = await calculateLedgerEntryStats({ ledgerId: data.ownerLedgerId, filters: {} });
    const mine = await calculateLedgerEntryStats({
      ledgerId: data.ownerLedgerId,
      filters: { attributedUserId: data.ownerId },
    });
    const partner = await calculateLedgerEntryStats({
      ledgerId: data.ownerLedgerId,
      filters: { attributedUserId: data.partnerId },
    });
    expect(all.convertedTotal?.total).toBe("30");
    expect(mine.convertedTotal?.total).toBe("20");
    expect(partner.convertedTotal?.total).toBe("10");
    const page = await listLedgerEntryPage({
      ledgerId: data.ownerLedgerId,
      filters: { attributedUserId: data.partnerId },
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.itemName).toBe("fixture");
  });
});
