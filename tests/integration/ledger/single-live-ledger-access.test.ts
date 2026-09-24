import { describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import {
  createTestUser,
  createTestUserWithLedger,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { ledgers, storedFiles, uploadSessionFiles, uploadSessions, users } from "@/persistence";
import { postgresAuthorizedFileRepository } from "@/application/adapters/postgres/authorized-files";
import { createStoredFileAdapter } from "@/application/adapters/storage";
import { serverComposition } from "@/application/server-composition-root";
import { createTestSourceDocument } from "tests/helpers/schema-setup";

/**
 * The access rule that replaced the `COUPLE_*` config: the account must be live
 * and the ledger must be the single live one. Nothing is read from the
 * environment, so "exactly one live ledger" is the whole authorization here.
 */
describe("single live ledger access", () => {
  it("lets the live account reach the live ledger and refuses a deleted account", async () => {
    const db = getTestDb();
    const { userId, ledgerId } = await createTestUserWithLedger(db);

    expect(await serverComposition.ledgers.getSharedForMember(userId)).not.toBeNull();
    expect(await serverComposition.ledgers.canAccess(ledgerId, userId)).toBe(true);

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));
    expect(await serverComposition.ledgers.getSharedForMember(userId)).toBeNull();
    expect(await serverComposition.ledgers.canAccess(ledgerId, userId)).toBe(false);
  });

  it("fails closed when no ledger is live, and when more than one is", async () => {
    const db = getTestDb();
    const { userId, ledgerId } = await createTestUserWithLedger(db);
    const secondLedgerId = crypto.randomUUID();
    await db.insert(ledgers).values({ id: secondLedgerId, userId });
    await ensureTestLedgerBooks(db, secondLedgerId);

    // Two live ledgers make "the single ledger" ambiguous: resolution closes
    // rather than picking one. 0048's guard refuses this state as well.
    expect(await serverComposition.ledgers.getSharedForMember(userId)).toBeNull();

    await db.update(ledgers).set({ deletedAt: new Date() }).where(eq(ledgers.id, secondLedgerId));
    expect(await serverComposition.ledgers.getSharedForMember(userId)).not.toBeNull();
    expect(await serverComposition.ledgers.canAccess(ledgerId, userId)).toBe(true);

    await db.update(ledgers).set({ deletedAt: new Date() }).where(eq(ledgers.id, ledgerId));
    expect(await serverComposition.ledgers.getSharedForMember(userId)).toBeNull();
  });

  it("scopes file reads and uploads to the live ledger and a live account", async () => {
    const db = getTestDb();
    const { userId, ledgerId } = await createTestUserWithLedger(db);
    // There is one account, so "who may read this file" is "is the account
    // live", not "does the account match the record's owner".
    const deleted = await createTestUser(db, undefined, crypto.randomUUID());
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted));

    await createTestSourceDocument(db, ledgerId, { imageUrls: ["fixture"] });
    const file = (await db.select().from(storedFiles))[0]!;
    expect(await postgresAuthorizedFileRepository.findForUser(userId, file.id)).not.toBeNull();
    expect(await postgresAuthorizedFileRepository.findForUser(deleted, file.id)).toBeNull();

    const sessionId = crypto.randomUUID();
    const targetId = crypto.randomUUID();
    await db.insert(uploadSessions).values({
      id: sessionId,
      ledgerId,
      finalizationTokenHash: "fixture",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(uploadSessionFiles).values({
      ledgerId,
      uploadSessionId: sessionId,
      targetId,
      position: 0,
      expectedContentType: "image/jpeg",
      expectedByteSize: 1,
    });
    const storage = new Map<string, Buffer>();
    const adapter = createStoredFileAdapter({
      storage: {
        async upload(key, bytes) {
          storage.set(key, bytes);
        },
        async download(key) {
          return storage.get(key)!;
        },
        async stream(key) {
          const bytes = storage.get(key)!;
          return new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(bytes));
              controller.close();
            },
          });
        },
        async presignUpload() {
          throw new Error("Unexpected direct upload in proxy storage fixture");
        },
        async readObject() {
          throw new Error("Unexpected object inspection in proxy storage fixture");
        },
        async delete(key) {
          storage.delete(key);
          return { success: true };
        },
      },
    });
    const upload = {
      uploadSessionId: sessionId,
      targetId,
      contentType: "image/jpeg",
      body: new Uint8Array([1]),
    };
    await expect(adapter.uploadTargetForUser({ ...upload, userId: deleted })).rejects.toThrow(
      NotFoundError
    );
    expect((await adapter.uploadTargetForUser({ ...upload, userId })).ownerLedgerId).toBe(ledgerId);
  });

  it("never provisions a personal ledger for an account without one", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, undefined, crypto.randomUUID());
    expect(await serverComposition.ledgers.getSharedForMember(userId)).toBeNull();
    expect(await db.query.ledgers.findFirst({ where: eq(ledgers.userId, userId) })).toBeUndefined();
  });
});
