import { readFileSync } from "node:fs";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/persistence";
import { computeHash } from "@/lib/security/service-credential-token";
import { insertFixture, type UploadedImage } from "../../../scripts/demo-data";
import {
  seedBooks,
  seedCategories,
  seedExchangeRates,
  seedLedger,
  seedSourceDocument,
} from "../../../scripts/lib/seed";
import { getTestDb } from "../../setup";

const fixture = JSON.parse(
  readFileSync(new URL("../../../scripts/fixtures/demo-workspace.json", import.meta.url), "utf8")
) as {
  documents: Array<{ image?: { fileId: string; filename: string } }>;
  serviceCredentials: Array<{ id: string; tokenBody: string }>;
};

describe("seed", () => {
  it("writes a ledger and a finished record with its files and entries", async () => {
    const db = getTestDb();
    const at = new Date("2026-03-04T12:00:00.000Z");
    await seedLedger(db, { mainCurrency: "USD", at });
    const books = await seedBooks(db, ["共同支出", "旅行"]);
    const categories = await seedCategories(db, [{ name: "Food", icon: "Utensils" }]);
    const documentId = await seedSourceDocument(db, {
      bookId: books.get("旅行")!,
      title: "Harbor Coffee",
      documentDate: "2026-03-04",
      attempts: [{ status: "failed", failureKind: "processing_error" }, { status: "completed" }],
      files: [{ byteSize: 3, originalFilename: "receipt.jpg" }],
      entries: [
        { itemName: "Flat White", amount: "16.00", currency: "USD" },
        {
          itemName: "Cake",
          amount: "9.50",
          currency: "USD",
          categoryId: categories.get("Food")!,
        },
      ],
      at,
    });
    await seedExchangeRates(db, "2026-03-04", [
      { currency: "EUR", dividend: "1", divisor: "1" },
      { currency: "USD", dividend: "7.8", divisor: "7.18" },
    ]);

    const [ledger] = await db.select().from(schema.ledgers);
    expect(ledger).toMatchObject({ mainCurrency: "USD", aiLanguage: "zh-CN" });
    expect(
      await db
        .select({ name: schema.books.name, sortOrder: schema.books.sortOrder })
        .from(schema.books)
        .orderBy(asc(schema.books.sortOrder))
    ).toEqual([
      { name: "共同支出", sortOrder: 1 },
      { name: "旅行", sortOrder: 2 },
    ]);

    const [document] = await db
      .select()
      .from(schema.sourceDocuments)
      .where(eq(schema.sourceDocuments.id, documentId));
    const attempts = await db
      .select()
      .from(schema.extractionAttempts)
      .where(eq(schema.extractionAttempts.sourceDocumentId, documentId));
    const latest = attempts.find((attempt) => attempt.status === "completed");
    expect(attempts).toHaveLength(2);
    expect(document?.latestAttemptId).toBe(latest?.id);
    expect(document?.documentDate).toBe("2026-03-04");

    const [file] = await db
      .select({ id: schema.storedFiles.id, storageKey: schema.storedFiles.storageKey })
      .from(schema.storedFiles)
      .innerJoin(
        schema.sourceDocumentFiles,
        eq(schema.sourceDocumentFiles.storedFileId, schema.storedFiles.id)
      )
      .where(eq(schema.sourceDocumentFiles.sourceDocumentId, documentId));
    expect(file?.storageKey).toBe(`stored/${file?.id}`);

    expect(
      await db
        .select({
          itemName: schema.ledgerEntries.itemName,
          position: schema.ledgerEntries.position,
          categoryId: schema.ledgerEntries.categoryId,
        })
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.sourceDocumentId, documentId))
        .orderBy(asc(schema.ledgerEntries.position))
    ).toEqual([
      { itemName: "Flat White", position: 0, categoryId: null },
      { itemName: "Cake", position: 1, categoryId: categories.get("Food") },
    ]);

    const rate = await db.execute<{ per_eur: string }>(
      sql`SELECT per_eur::text FROM exchange_rates WHERE currency = 'USD'`
    );
    expect(rate.rows[0]?.per_eur).toBe(
      (await db.execute<{ value: string }>(sql`SELECT (7.8 / 7.18)::text AS value`)).rows[0]?.value
    );
  });

  it("restores the whole demo workspace into the current schema", async () => {
    const db = getTestDb();
    const images: UploadedImage[] = fixture.documents.flatMap((document) =>
      document.image == null
        ? []
        : [{ ...document.image, bytes: Buffer.from(document.image.fileId) }]
    );
    const workspace = { uploadedImages: images };

    const environment = { CASHIER_DEMO_AS_OF: "2026-03-04" };

    await db.transaction((tx) => insertFixture(tx, environment, { ...workspace, reset: false }));
    // A reset replaces the workspace rather than layering a second copy on it.
    await db.transaction((tx) => insertFixture(tx, environment, { ...workspace, reset: true }));

    const counts = await db.execute<Record<string, number>>(sql`
      SELECT
        (SELECT count(*)::int FROM ledgers) AS ledgers,
        (SELECT count(*)::int FROM books) AS books,
        (SELECT count(*)::int FROM entry_categories) AS categories,
        (SELECT count(*)::int FROM source_documents) AS documents,
        (SELECT count(*)::int FROM source_documents WHERE latest_attempt_id IS NULL)
          AS without_attempt,
        (SELECT count(*)::int FROM ledger_entries) AS entries,
        (SELECT count(*)::int FROM service_credentials) AS credentials
    `);
    expect(counts.rows[0]).toEqual({
      ledgers: 1,
      books: 3,
      categories: 7,
      documents: 28,
      without_attempt: 0,
      entries: 26,
      credentials: 3,
    });

    const keys = await db
      .select({ id: schema.storedFiles.id, storageKey: schema.storedFiles.storageKey })
      .from(schema.storedFiles);
    expect(keys).toHaveLength(images.length);
    for (const { id, storageKey } of keys) {
      expect(storageKey).toBe(`stored/${id}`);
    }

    // The keys the demo banner prints authenticate against the stored hashes.
    const credentials = await db
      .select({ id: schema.serviceCredentials.id, hash: schema.serviceCredentials.tokenHash })
      .from(schema.serviceCredentials);
    for (const credential of fixture.serviceCredentials) {
      expect(credentials.find((row) => row.id === credential.id)?.hash).toBe(
        computeHash(`sk_live_${credential.tokenBody}`)
      );
    }
  });
});
