import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { POST } from "@/app/api/v1/source-documents/route";
import { GET } from "@/app/api/v1/source-documents/[sourceDocumentId]/route";
import { getTestDb } from "../../setup";
import { flushAfterCallbacks } from "../../setup.common";
import { insertExchangeRates } from "../../helpers/exchange-rates";
import { TEST_USER_ID, createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import {
  exchangeRates,
  ledgers,
  ledgerEntries,
  serviceCredentials,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";
import { computeHash, prefixSuffix } from "@/lib/security/service-credential-token";

async function validJpegBase64(): Promise<string> {
  const buffer = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();
  return buffer.toString("base64");
}

// Hoisted shared memory store so the beforeEach and vi.mock factory share the same Map
const mockR2 = vi.hoisted(() => {
  const files = new Map<string, Buffer>();
  let uploadError: unknown = null;
  return {
    files,
    setUploadError: (error: unknown) => {
      uploadError = error;
    },
    getStorage: () => ({
      upload: async (key: string, data: Buffer) => {
        if (uploadError != null) throw uploadError;
        files.set(key, Buffer.from(data));
      },
      download: async (key: string) => {
        const data = files.get(key);
        if (data == null) throw new Error("File not found");
        return Buffer.from(data);
      },
      delete: async (key: string) => {
        files.delete(key);
        return { success: true };
      },
    }),
    R2StorageProvider: class {
      async upload(key: string, data: Buffer) {
        if (uploadError != null) throw uploadError;
        files.set(key, Buffer.from(data));
      }
      async download(key: string) {
        const data = files.get(key);
        if (data == null) throw new Error("File not found");
        return Buffer.from(data);
      }
      async delete(key: string) {
        files.delete(key);
        return { success: true };
      }
    },
  };
});

vi.mock("@/lib/storage/s3", () => ({
  S3StorageProvider: mockR2.R2StorageProvider,
  getS3Storage: mockR2.getStorage,
}));

describe("API v1 source-documents route", () => {
  let ledgerId: string;

  let credentialKey: string;

  beforeEach(async () => {
    const db = getTestDb();
    mockR2.files.clear();
    mockR2.setUploadError(null);

    await db.delete(ledgers);
    const setup = await createTestUserWithLedger(db, undefined, "Route Test Ledger", TEST_USER_ID);
    ledgerId = setup.ledgerId;

    credentialKey = `sk_route_${crypto.randomUUID().replace(/-/g, "")}`;
    const { prefix, suffix } = prefixSuffix(credentialKey);
    await db
      .insert(serviceCredentials)
      .values({
        ledgerId,
        name: "Route Credential",
        tokenHash: computeHash(credentialKey),
        bookId: await testBookId(db, ledgerId),
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning();
  });

  it("GET returns processing status with retry and private no-store headers", async () => {
    const image = await validJpegBase64();
    const created = await POST(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${credentialKey}` },
        body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
      })
    ).then((response) => response.json());
    const response = await GET(
      new NextRequest(`http://localhost/api/v1/source-documents/${created.sourceDocumentId}`, {
        headers: { Authorization: `Bearer ${credentialKey}` },
      }),
      { params: Promise.resolve({ sourceDocumentId: created.sourceDocumentId }) }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toMatchObject({
      sourceDocumentId: created.sourceDocumentId,
      revisionId: created.revisionId,
      status: "processing",
      result: null,
      error: null,
    });
  });

  it("GET returns only the stable completed result projection and hides unknown IDs", async () => {
    const image = await validJpegBase64();
    const created = await POST(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${credentialKey}` },
        body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
      })
    ).then((response) => response.json());
    // Let the parse the POST scheduled finish before rewriting its rows by hand;
    // otherwise both sides take ledger row locks and can deadlock.
    await flushAfterCallbacks();
    const db = getTestDb();
    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      sourceDocumentRevisionId: created.revisionId,
      itemName: "Lunch",
      description: "Noodles",
      amount: "12.50",
      currency: "CNY",
      position: 0,
    });
    await db
      .update(sourceDocumentRevisions)
      .set({ processingStatus: "completed", finishedAt: new Date() })
      .where(eq(sourceDocumentRevisions.id, created.revisionId));
    await db
      .update(sourceDocuments)
      .set({
        title: "Lunch receipt",
        activeRevisionId: created.revisionId,
        latestSubmissionRevisionId: null,
      })
      .where(eq(sourceDocuments.id, created.sourceDocumentId));

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/source-documents/${created.sourceDocumentId}`, {
        headers: { Authorization: `Bearer ${credentialKey}` },
      }),
      { params: Promise.resolve({ sourceDocumentId: created.sourceDocumentId }) }
    );
    const body = await response.json();
    expect(body.result).toEqual({
      title: "Lunch receipt",
      total: "12.50",
      totalCurrency: "CNY",
      entries: [
        {
          name: "Lunch",
          description: "Noodles",
          amount: "12.500",
          currency: "CNY",
          category: null,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/fileId|metadata|outbox|stack|storageKey/);

    const unknownId = crypto.randomUUID();
    const missing = await GET(
      new NextRequest(`http://localhost/api/v1/source-documents/${unknownId}`, {
        headers: { Authorization: `Bearer ${credentialKey}` },
      }),
      { params: Promise.resolve({ sourceDocumentId: unknownId }) }
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
  });

  it("GET reports an unparsable document with a stable code and the AI reason", async () => {
    const image = await validJpegBase64();
    const created = await POST(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${credentialKey}` },
        body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
      })
    ).then((response) => response.json());
    const db = getTestDb();
    await db
      .update(sourceDocumentRevisions)
      .set({
        processingStatus: "failed",
        failureKind: "invalid_input",
        failureCode: "ai_declared_invalid",
        failureMessage: "This is a refund, not an expense.",
        finishedAt: new Date(),
      })
      .where(eq(sourceDocumentRevisions.id, created.revisionId));

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/source-documents/${created.sourceDocumentId}`, {
        headers: { Authorization: `Bearer ${credentialKey}` },
      }),
      { params: Promise.resolve({ sourceDocumentId: created.sourceDocumentId }) }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceDocumentId: created.sourceDocumentId,
      status: "invalid",
      result: null,
      error: { code: "VALIDATION_FAILED", message: "This is a refund, not an expense." },
    });
  });

  it("GET omits the AI reason when a failed document has none", async () => {
    const image = await validJpegBase64();
    const created = await POST(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${credentialKey}` },
        body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
      })
    ).then((response) => response.json());
    const db = getTestDb();
    await db
      .update(sourceDocumentRevisions)
      .set({
        processingStatus: "failed",
        failureKind: "invalid_input",
        failureCode: "entry_validation_failed",
        failureMessage: null,
        finishedAt: new Date(),
      })
      .where(eq(sourceDocumentRevisions.id, created.revisionId));

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/source-documents/${created.sourceDocumentId}`, {
        headers: { Authorization: `Bearer ${credentialKey}` },
      }),
      { params: Promise.resolve({ sourceDocumentId: created.sourceDocumentId }) }
    );
    const body = await response.json();
    expect(body.status).toBe("invalid");
    expect(body.error).toEqual({ code: "VALIDATION_FAILED", message: null });
  });

  it("totals converted amounts in the ledger main currency instead of raw amounts", async () => {
    await insertExchangeRates(new Date().toISOString().slice(0, 10), { USD: 1, CNY: 5 });
    const image = await validJpegBase64();
    const created = await POST(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${credentialKey}` },
        body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
      })
    ).then((response) => response.json());
    const db = getTestDb();
    await db.update(ledgers).set({ mainCurrency: "USD" }).where(eq(ledgers.id, ledgerId));
    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId: created.sourceDocumentId,
        sourceDocumentRevisionId: created.revisionId,
        itemName: "USD purchase",
        description: null,
        amount: "10.000",
        currency: "USD",
        position: 0,
      },
      {
        ledgerId,
        sourceDocumentId: created.sourceDocumentId,
        sourceDocumentRevisionId: created.revisionId,
        itemName: "Local coffee",
        description: null,
        amount: "5.000",
        currency: "CNY",
        position: 1,
      },
    ]);
    await db
      .update(sourceDocumentRevisions)
      .set({ processingStatus: "completed", finishedAt: new Date() })
      .where(eq(sourceDocumentRevisions.id, created.revisionId));
    await db
      .update(sourceDocuments)
      .set({
        title: "Mixed receipt",
        activeRevisionId: created.revisionId,
        latestSubmissionRevisionId: null,
      })
      .where(eq(sourceDocuments.id, created.sourceDocumentId));

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/source-documents/${created.sourceDocumentId}`, {
        headers: { Authorization: `Bearer ${credentialKey}` },
      }),
      { params: Promise.resolve({ sourceDocumentId: created.sourceDocumentId }) }
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.result.total).toBe("11.00");
    expect(body.result.total).not.toBe("15.00");
    expect(body.result.totalCurrency).toBe("USD");
    expect(body.result.entries).toEqual([
      {
        name: "USD purchase",
        description: null,
        amount: "10.000",
        currency: "USD",
        category: null,
      },
      {
        name: "Local coffee",
        description: null,
        amount: "5.000",
        currency: "CNY",
        category: null,
      },
    ]);
  });

  it("reports a null total while an entry has no exchange rate for its day", async () => {
    const image = await validJpegBase64();
    const created = await POST(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${credentialKey}` },
        body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
      })
    ).then((response) => response.json());
    await flushAfterCallbacks();
    const db = getTestDb();
    // The provider does not publish BHD; drop whatever the request cached.
    await db.delete(exchangeRates);
    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      sourceDocumentRevisionId: created.revisionId,
      itemName: "Dinar purchase",
      amount: "12.500",
      currency: "BHD",
      position: 0,
    });
    await db
      .update(sourceDocumentRevisions)
      .set({ processingStatus: "completed", finishedAt: new Date() })
      .where(eq(sourceDocumentRevisions.id, created.revisionId));
    await db
      .update(sourceDocuments)
      .set({
        activeRevisionId: created.revisionId,
        latestSubmissionRevisionId: null,
      })
      .where(eq(sourceDocuments.id, created.sourceDocumentId));

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/source-documents/${created.sourceDocumentId}`, {
        headers: { Authorization: `Bearer ${credentialKey}` },
      }),
      { params: Promise.resolve({ sourceDocumentId: created.sourceDocumentId }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.total).toBeNull();
    expect(body.result.totalCurrency).toBe("CNY");
    expect(body.result.entries).toEqual([
      expect.objectContaining({ name: "Dinar purchase", amount: "12.500", currency: "BHD" }),
    ]);
  });
});
