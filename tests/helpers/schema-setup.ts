import { and, eq, isNull, sql } from "drizzle-orm";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/persistence";

type TestDatabase = NodePgDatabase<typeof schema>;

export const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";
export const TEST_PARTNER_USER_ID = "11111111-1111-4111-8111-111111111111";

export async function configureTestCoupleLedger(
  db: TestDatabase,
  ledgerId: string,
  ownerId = TEST_USER_ID
): Promise<void> {
  const partnerId = ownerId === TEST_PARTNER_USER_ID ? TEST_USER_ID : TEST_PARTNER_USER_ID;
  const partner = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, partnerId))
    .limit(1);
  if (partner.length === 0) await createTestUser(db, undefined, partnerId);
  process.env.COUPLE_OWNER_USER_ID = ownerId;
  process.env.COUPLE_PARTNER_USER_ID = partnerId;
  process.env.COUPLE_LEDGER_ID = ledgerId;
}

function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

// Helper to create a test user and return the user ID
export async function createTestUser(
  db: TestDatabase,
  email?: string, // 改为可选，默认使用随机email避免冲突
  id = TEST_USER_ID
): Promise<string> {
  // 使用随机email避免唯一约束冲突
  const finalEmail = email ?? `test-${crypto.randomUUID()}@example.com`;

  const existing = await db
    .select()
    .from(schema.users)
    .where(sql`${schema.users.id} = ${id}`)
    .limit(1);
  if (existing.length !== 0) {
    // Keep the stable fixture identity while allowing callers to choose a fresh email.
    await db
      .update(schema.users)
      .set({ email: finalEmail })
      .where(sql`${schema.users.id} = ${id}`);
    return id;
  }

  await db.insert(schema.users).values({
    id,
    email: finalEmail,
    name: "Test User",
    emailVerified: new Date(),
  });
  return id;
}

// Helper to create a test user and ledger together
export async function createTestUserWithLedger(
  db: TestDatabase,
  email?: string, // 改为可选，默认使用随机email
  _ledgerName?: string, // 已废弃，账本名称不再使用
  userId?: string
): Promise<{ userId: string; ledgerId: string }> {
  const finalUserId = await createTestUser(db, email, userId ?? TEST_USER_ID);

  const ledgerId = crypto.randomUUID();
  await db.insert(schema.ledgers).values({
    id: ledgerId,
    userId: finalUserId,
  });

  if (finalUserId === TEST_USER_ID) {
    await configureTestCoupleLedger(db, ledgerId);
  }

  return { userId: finalUserId, ledgerId };
}

// Helper to create a test source document
export async function createTestSourceDocument(
  db: TestDatabase,
  ledgerId: string,
  overrides: Partial<{
    text: string;
    status: "processing" | "completed" | "invalid" | "failed" | "cancelled" | "deleted";
    imageUrls: string[];
    entryDate: string | null;
    title: string | null;
  }> = {}
): Promise<string> {
  return db.transaction(async (tx) => {
    const status = overrides.status ?? "completed";
    const doc = requireDefined(
      (
        await tx
          .insert(schema.sourceDocuments)
          .values({
            ledgerId,
            documentDate: overrides.entryDate,
            title: overrides.title,
            attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${ledgerId})`,
          })
          .returning()
      )[0],
      "Expected inserted source document"
    );
    const revision = requireDefined(
      (
        await tx
          .insert(schema.sourceDocumentRevisions)
          .values({
            ledgerId,
            sourceDocumentId: doc.id,
            revisionNumber: 1,
            inputText: overrides.text ?? "Test document",
            processingStatus:
              status === "processing"
                ? "processing"
                : status === "invalid" || status === "failed"
                  ? "failed"
                  : "completed",
            failureKind:
              status === "invalid"
                ? "invalid_input"
                : status === "failed"
                  ? "processing_error"
                  : null,
            finishedAt: status === "processing" ? null : new Date(),
          })
          .returning()
      )[0],
      "Expected inserted source document revision"
    );
    await tx
      .update(schema.sourceDocuments)
      .set(
        revision.processingStatus === "completed"
          ? { activeRevisionId: revision.id, latestSubmissionRevisionId: revision.id }
          : { activeRevisionId: null, latestSubmissionRevisionId: revision.id }
      )
      .where(eq(schema.sourceDocuments.id, doc.id));
    for (const [position] of (overrides.imageUrls ?? []).entries()) {
      const file = requireDefined(
        (
          await tx
            .insert(schema.storedFiles)
            .values({
              ledgerId,
              storageProvider: "local",
              storageKey: `tests/${doc.id}/${position}`,
              contentType: "image/jpeg",
              byteSize: 1,
              finalizedAt: new Date(),
            })
            .returning()
        )[0],
        "Expected inserted stored file"
      );
      await tx.insert(schema.revisionFiles).values({
        ledgerId,
        revisionId: revision.id,
        storedFileId: file.id,
        position,
      });
    }
    if (status === "deleted") {
      await tx
        .update(schema.sourceDocuments)
        .set({ deletedAt: new Date() })
        .where(eq(schema.sourceDocuments.id, doc.id));
    }
    return doc.id;
  });
}

/** Attach fixture ledger entries to a canonical completed revision. */
export async function activateTestSourceDocumentProjection(
  db: TestDatabase,
  sourceDocumentId: string,
  content: { text?: string | null; imageUrls?: string[] } = {}
): Promise<string> {
  return db.transaction(async (tx) => {
    const documents = await tx
      .select()
      .from(schema.sourceDocuments)
      .where(eq(schema.sourceDocuments.id, sourceDocumentId))
      .limit(1);
    const document = documents[0];
    if (document == null) throw new Error("Expected source document fixture");
    let revisionId = document.activeRevisionId ?? document.latestSubmissionRevisionId;
    if (revisionId == null) {
      const revision = requireDefined(
        (
          await tx
            .insert(schema.sourceDocumentRevisions)
            .values({
              ledgerId: document.ledgerId,
              sourceDocumentId: document.id,
              revisionNumber: 1,
              inputText: content.text,
              origin: "submission",
              processingStatus: "completed",
              finishedAt: new Date(),
            })
            .returning()
        )[0],
        "Expected inserted source document revision"
      );
      revisionId = revision.id;
      await tx
        .update(schema.sourceDocuments)
        .set({ activeRevisionId: revisionId, latestSubmissionRevisionId: revisionId })
        .where(eq(schema.sourceDocuments.id, sourceDocumentId));
      for (const [position] of (content.imageUrls ?? []).entries()) {
        const file = requireDefined(
          (
            await tx
              .insert(schema.storedFiles)
              .values({
                ledgerId: document.ledgerId,
                storageProvider: "local",
                storageKey: `tests/${document.id}/${position}`,
                contentType: "image/jpeg",
                byteSize: 1,
                finalizedAt: new Date(),
              })
              .returning()
          )[0],
          "Expected inserted stored file"
        );
        await tx.insert(schema.revisionFiles).values({
          ledgerId: document.ledgerId,
          revisionId,
          storedFileId: file.id,
          position,
        });
      }
    }
    const entries = await tx
      .select()
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.sourceDocumentId, sourceDocumentId),
          isNull(schema.ledgerEntries.sourceDocumentRevisionId)
        )
      );
    const occupiedEntries = await tx
      .select({ position: schema.ledgerEntries.position })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.sourceDocumentRevisionId, revisionId));
    const startingPosition = occupiedEntries.reduce(
      (next, entry) => Math.max(next, entry.position + 1),
      0
    );
    for (const [index, entry] of entries.entries()) {
      await tx
        .update(schema.ledgerEntries)
        .set({ sourceDocumentRevisionId: revisionId, position: startingPosition + index })
        .where(eq(schema.ledgerEntries.id, entry.id));
    }
    return revisionId;
  });
}
