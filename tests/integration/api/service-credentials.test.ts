import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as ledgerEntryPOST } from "@/app/api/v1/source-documents/route";
import { getTestDb } from "../../setup";
import {
  books,
  ledgers,
  serviceCredentials,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";
import { eq } from "drizzle-orm";
import { TEST_USER_ID, createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import {
  createServiceCredentialAction,
  deleteServiceCredentialAction,
  getServiceCredentialsAction,
} from "@/modules/ledger/server-actions/credentials";
import { getLedgerSettingsAction } from "@/modules/ledger/server/get-ledger-settings";
import { formatDateTimeForApi, getDateInTimezone } from "@/lib/date-utils";
import { ValidationError } from "@/lib/errors";
import { computeHash } from "@/lib/security/service-credential-token";
import sharp from "sharp";

async function validJpegBase64(): Promise<string> {
  return (
    await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .jpeg()
      .toBuffer()
  ).toString("base64");
}

function requireFirst<T>(rows: readonly T[], label: string): T {
  const first = rows[0];
  if (first === undefined) {
    throw new Error(`Expected at least one ${label}`);
  }
  return first;
}

// Mock Processing

const mockR2 = vi.hoisted(() => {
  const files = new Map<string, Buffer>();
  return {
    R2StorageProvider: class {
      async upload(key: string, data: Buffer) {
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
  getS3Storage: () => new mockR2.R2StorageProvider(),
}));

const { submitMock } = vi.hoisted(() => ({
  submitMock: vi.fn().mockResolvedValue("mock-task-id"),
}));

// Mock Task Runtime
vi.mock("@/lib/tasks", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...(original as Record<string, unknown>),
    submitTask: submitMock,
  };
});

// Mock Tasks

describe("Service Credentials & Ledger Entry Ingestion", () => {
  let testLedgerId: string;

  beforeEach(async () => {
    const db = getTestDb();

    await db.delete(ledgers).where(eq(ledgers.userId, TEST_USER_ID));
    const { ledgerId } = await createTestUserWithLedger(
      db,
      undefined,
      "API Test Ledger",
      TEST_USER_ID
    );
    testLedgerId = ledgerId;
  });

  it("should create and list service credentials via Actions", async () => {
    // Create Credential - returns data with one-time token
    const createRes = await createServiceCredentialAction(testLedgerId, {
      name: "Test Credential",
      bookId: await testBookId(getTestDb(), testLedgerId),
    });

    expect(createRes).toBeDefined();
    expect(createRes.token).toBeDefined();
    expect(createRes.tokenPrefix).toBeDefined();
    expect(createRes.tokenSuffix).toBeDefined();
    expect(createRes.name).toBe("Test Credential");

    // The token should match the expected format
    expect(createRes.token).toMatch(/^sk_live_[0-9a-f]{48}$/);

    // Verify hash is stored, not plaintext
    const db = getTestDb();
    const stored = await db.query.serviceCredentials.findFirst({
      where: eq(serviceCredentials.id, createRes.id),
    });
    expect(stored?.tokenHash).toBeDefined();
    expect(stored).not.toHaveProperty("key");
    expect(computeHash(createRes.token)).toBe(stored?.tokenHash);

    // List Credentials
    const listRes = await getServiceCredentialsAction(testLedgerId);
    const listedCredential = requireFirst(listRes, "service credential");

    expect(listRes).toHaveLength(1);
    expect(listedCredential.id).toBe(createRes.id);
    // List should not include the full token
    expect((listedCredential as Record<string, unknown>).key).toBeUndefined();
    expect((listedCredential as Record<string, unknown>).token).toBeUndefined();
    // List should include prefix/suffix
    expect(listedCredential.tokenPrefix).toBe(createRes.tokenPrefix);
    expect(listedCredential.tokenSuffix).toBe(createRes.tokenSuffix);
  });

  it("rejects blank credential name with ValidationError", async () => {
    await expect(
      createServiceCredentialAction(testLedgerId, {
        name: "",
        bookId: await testBookId(getTestDb(), testLedgerId),
      } as never)
    ).rejects.toThrow(ValidationError);
  });

  it("rejects invalid credential id with ValidationError", async () => {
    await expect(deleteServiceCredentialAction(testLedgerId, "bad-id")).rejects.toThrow(
      ValidationError
    );
  });

  it("should ingest ledger entry with valid service credential", async () => {
    // Setup: create a hash-only credential with a known bearer token.
    const db = getTestDb();
    const knownToken = "sk_test_123";
    const { computeHash, prefixSuffix } = await import("@/lib/security/service-credential-token");
    const hash = computeHash(knownToken);
    const { prefix, suffix } = prefixSuffix(knownToken);
    const createdCredentials = await db
      .insert(serviceCredentials)
      .values({
        ledgerId: testLedgerId,
        name: "Ingest Credential",
        tokenHash: hash,
        bookId: await testBookId(db, testLedgerId),
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning();
    requireFirst(createdCredentials, "service credential");

    const image = await validJpegBase64();
    const req = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${knownToken}`,
      },
      body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
    });

    const res = await ledgerEntryPOST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe("processing");

    // Check DB
    const doc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, data.sourceDocumentId),
    });
    expect(doc).toBeDefined();
    expect(doc?.ledgerId).toBe(testLedgerId);
    expect(doc?.bookId).toBe(await testBookId(db, testLedgerId));
    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.sourceDocumentId, data.sourceDocumentId),
    });
    expect(revision?.inputText).toBeNull();
    expect(revision?.processingStatus).toBe("processing");
  });

  it("should reject ledger entry with invalid service credential", async () => {
    const req = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer invalid_key`,
      },
      body: JSON.stringify({ text: "API Ledger Entry" }),
    });

    const res = await ledgerEntryPOST(req);
    expect(res.status).toBe(401);
  });

  it("should reject invalid JSON body", async () => {
    const db = getTestDb();
    const knownToken = "sk_invalid_json";
    const { computeHash, prefixSuffix } = await import("@/lib/security/service-credential-token");
    const hash = computeHash(knownToken);
    const { prefix, suffix } = prefixSuffix(knownToken);
    const createdCredentials = await db
      .insert(serviceCredentials)
      .values({
        ledgerId: testLedgerId,
        name: "Broken Body Credential",
        tokenHash: hash,
        bookId: await testBookId(db, testLedgerId),
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning();
    requireFirst(createdCredentials, "service credential");

    const req = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${knownToken}`,
        "Content-Type": "application/json",
      },
      body: "{",
    });

    const res = await ledgerEntryPOST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error.code).toBe("VALIDATION_FAILED");
  });

  it("should derive entryDate when entryDate is omitted", async () => {
    const db = getTestDb();
    const knownToken = "sk_timezone";
    const { computeHash, prefixSuffix } = await import("@/lib/security/service-credential-token");
    const hash = computeHash(knownToken);
    const { prefix, suffix } = prefixSuffix(knownToken);
    const createdCredentials = await db
      .insert(serviceCredentials)
      .values({
        ledgerId: testLedgerId,
        name: "Timezone Credential",
        tokenHash: hash,
        bookId: await testBookId(db, testLedgerId),
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning();
    requireFirst(createdCredentials, "service credential");

    const image = await validJpegBase64();
    const req = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${knownToken}`,
      },
      body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
    });

    const res = await ledgerEntryPOST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    const doc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, data.sourceDocumentId),
    });
    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, doc!.latestSubmissionRevisionId!),
    });

    expect(doc?.documentDate).toBeNull();
    // The fixture book has no zone of its own, so the server date decides.
    expect(revision?.inputDocumentDate).toBe(formatDateTimeForApi(new Date()));
  });

  it("dates an upload in its key's book zone", async () => {
    const db = getTestDb();
    const knownToken = "sk_book_zone";
    const { computeHash, prefixSuffix } = await import("@/lib/security/service-credential-token");
    // Give the key's book a zone so the upload is dated in that book's day.
    const zonedBookId = crypto.randomUUID();
    await db.insert(books).values({
      id: zonedBookId,
      ledgerId: testLedgerId,
      name: "Zoned",
      sortOrder: 9,
      timeZone: "Pacific/Kiritimati",
    });
    const { prefix, suffix } = prefixSuffix(knownToken);
    const createdCredentials = await db
      .insert(serviceCredentials)
      .values({
        ledgerId: testLedgerId,
        name: "Zoned Credential",
        tokenHash: computeHash(knownToken),
        bookId: zonedBookId,
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning();
    requireFirst(createdCredentials, "service credential");

    const req = new NextRequest("http://localhost/api/v1/source-documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${knownToken}` },
      body: JSON.stringify({ images: [{ data: await validJpegBase64(), mimeType: "image/jpeg" }] }),
    });
    const res = await ledgerEntryPOST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    const doc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, data.sourceDocumentId),
    });
    // The record went to the key's book, not to the ledger's default one.
    expect(doc?.bookId).toBe(zonedBookId);
    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, doc!.latestSubmissionRevisionId!),
    });
    expect(revision?.inputDocumentDate).toBe(getDateInTimezone("Pacific/Kiritimati"));
  });

  it("should delete service credential via Action", async () => {
    const db = getTestDb();
    // Create credential via action to get proper hash
    const createRes = await createServiceCredentialAction(testLedgerId, {
      name: "Delete Credential",
      bookId: await testBookId(getTestDb(), testLedgerId),
    });

    // deleteServiceCredentialAction returns void
    await deleteServiceCredentialAction(testLedgerId, createRes.id);

    const check = await db.query.serviceCredentials.findFirst({
      where: eq(serviceCredentials.id, createRes.id),
    });
    expect(check).toBeDefined();
    expect(check?.deletedAt).not.toBeNull();
  });

  it("tracks last use and rejects authentication immediately after revoke", async () => {
    const db = getTestDb();
    const credential = await createServiceCredentialAction(testLedgerId, {
      name: "Lifecycle Credential",
      bookId: await testBookId(getTestDb(), testLedgerId),
    });
    const image = await validJpegBase64();
    const firstResponse = await ledgerEntryPOST(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "Idempotency-Key": "credential-lifecycle-record",
        },
        body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
      })
    );
    const created = await firstResponse.json();
    expect(firstResponse.status).toBe(201);
    const usedCredential = await db.query.serviceCredentials.findFirst({
      where: eq(serviceCredentials.id, credential.id),
    });
    expect(usedCredential?.lastUsedAt).toBeInstanceOf(Date);

    await deleteServiceCredentialAction(testLedgerId, credential.id);
    const revokedResponse = await ledgerEntryPOST(
      new NextRequest("http://localhost/api/v1/source-documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${credential.token}` },
        body: JSON.stringify({ text: "Must be rejected" }),
      })
    );
    expect(revokedResponse.status).toBe(401);
    expect(
      await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, created.sourceDocumentId),
      })
    ).toBeDefined();
  });

  it("throttles lastUsedAt updates to once per five minutes", async () => {
    const db = getTestDb();
    const credential = await createServiceCredentialAction(testLedgerId, {
      name: "Throttle Credential",
      bookId: await testBookId(getTestDb(), testLedgerId),
    });
    const image = await validJpegBase64();
    const post = () =>
      ledgerEntryPOST(
        new NextRequest("http://localhost/api/v1/source-documents", {
          method: "POST",
          headers: { Authorization: `Bearer ${credential.token}` },
          body: JSON.stringify({ images: [{ data: image, mimeType: "image/jpeg" }] }),
        })
      );
    const readLastUsedAt = async () => {
      const row = await db.query.serviceCredentials.findFirst({
        where: eq(serviceCredentials.id, credential.id),
      });
      return row?.lastUsedAt ?? null;
    };

    // First authentication writes lastUsedAt.
    expect((await post()).status).toBe(201);
    const firstUsedAt = await readLastUsedAt();
    expect(firstUsedAt).toBeInstanceOf(Date);

    // A credential used two minutes ago is still fresh: repeated auth must not
    // write the column again.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    await db
      .update(serviceCredentials)
      .set({ lastUsedAt: twoMinutesAgo })
      .where(eq(serviceCredentials.id, credential.id));
    expect((await post()).status).toBe(201);
    expect((await readLastUsedAt())?.getTime()).toBe(twoMinutesAgo.getTime());

    // Once the record is older than five minutes the next auth refreshes it.
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    await db
      .update(serviceCredentials)
      .set({ lastUsedAt: sixMinutesAgo })
      .where(eq(serviceCredentials.id, credential.id));
    expect((await post()).status).toBe(201);
    expect((await readLastUsedAt())?.getTime()).toBeGreaterThan(sixMinutesAgo.getTime());
  });

  it("should return credentials with prefix/suffix via getLedgerSettingsAction", async () => {
    // Create a credential via action to get proper hash-based credential
    const created = await createServiceCredentialAction(testLedgerId, {
      name: "New Credential",
      bookId: await testBookId(getTestDb(), testLedgerId),
    });

    // Get settings via getLedgerSettingsAction
    const settings = await getLedgerSettingsAction(testLedgerId);
    const settingsCredential = requireFirst(settings.credentials, "settings credential");

    expect(settings.credentials).toHaveLength(1);
    expect(settingsCredential.name).toBe("New Credential");
    // The credential should have prefix/suffix, not full key
    expect(settingsCredential.tokenPrefix).toBe(created.tokenPrefix);
    expect(settingsCredential.tokenSuffix).toBe(created.tokenSuffix);
    expect((settingsCredential as Record<string, unknown>).key).toBeUndefined();
  });
});
