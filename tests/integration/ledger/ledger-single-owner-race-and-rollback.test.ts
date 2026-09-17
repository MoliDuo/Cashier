import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestSourceDocument, createTestUser } from "tests/helpers/schema-setup";
import { ledgers, storedFiles, uploadSessionFiles, uploadSessions, users } from "@/persistence";
import { postgresAuthorizedFileRepository } from "@/application/adapters/postgres/authorized-files";
import { createStoredFileAdapter } from "@/application/adapters/local/stored-files";
import { serverComposition } from "@/application/server-composition-root";

const originalConfig = {
  owner: process.env.COUPLE_OWNER_USER_ID,
  partner: process.env.COUPLE_PARTNER_USER_ID,
  ledger: process.env.COUPLE_LEDGER_ID,
};
afterEach(() => {
  for (const [name, value] of [
    ["COUPLE_OWNER_USER_ID", originalConfig.owner],
    ["COUPLE_PARTNER_USER_ID", originalConfig.partner],
    ["COUPLE_LEDGER_ID", originalConfig.ledger],
  ] as const) {
    if (value == null) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("couple ledger provisioning", () => {
  it("allows both active members but denies a third user and fails closed", async () => {
    const db = getTestDb();
    const owner = await createTestUser(db);
    const partner = await createTestUser(db, undefined, crypto.randomUUID());
    const outsider = await createTestUser(db, undefined, crypto.randomUUID());
    const ledgerId = crypto.randomUUID();
    await db.insert(ledgers).values({ id: ledgerId, userId: owner });
    process.env.COUPLE_OWNER_USER_ID = owner;
    process.env.COUPLE_PARTNER_USER_ID = partner;
    process.env.COUPLE_LEDGER_ID = ledgerId;
    expect(await serverComposition.ledgers.getSharedForMember(owner)).not.toBeNull();
    expect(await serverComposition.ledgers.getSharedForMember(partner)).not.toBeNull();
    expect(await serverComposition.ledgers.getSharedForMember(outsider)).toBeNull();
    const existingLedger = (await db.select().from(ledgers).where(eq(ledgers.id, ledgerId)))[0]!;
    const updated = await serverComposition.settings.updateWithCurrencyRecalculation({
      ledgerId,
      userId: partner,
      expectedUpdatedAt: existingLedger.updatedAt.toISOString(),
      settings: { collapseEntriesDefault: true },
    });
    expect(updated?.settings.collapseEntriesDefault).toBe(true);
    await createTestSourceDocument(db, ledgerId, { imageUrls: ["fixture"] });
    const file = (await db.select().from(storedFiles))[0]!;
    expect(await postgresAuthorizedFileRepository.findForUser(partner, file.id)).not.toBeNull();
    expect(await postgresAuthorizedFileRepository.findForUser(outsider, file.id)).toBeNull();
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
    await expect(adapter.uploadTargetForUser({ ...upload, userId: outsider })).rejects.toThrow();
    expect((await adapter.uploadTargetForUser({ ...upload, userId: partner })).ownerLedgerId).toBe(
      ledgerId
    );
    delete process.env.COUPLE_LEDGER_ID;
    expect(await serverComposition.ledgers.getSharedForMember(owner)).toBeNull();
    process.env.COUPLE_LEDGER_ID = ledgerId;
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, partner));
    expect(await serverComposition.ledgers.getSharedForMember(owner)).toBeNull();
  });
  it("does not create a third personal ledger", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, undefined, crypto.randomUUID());
    expect(await serverComposition.ledgers.getSharedForMember(userId)).toBeNull();
    expect(await db.query.ledgers.findFirst({ where: eq(ledgers.userId, userId) })).toBeUndefined();
  });
});
