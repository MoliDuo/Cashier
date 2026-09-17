import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ledgers,
  revisionFiles,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { getCoupleConfig } from "@/lib/couple-config";
import { postgresLedgerAdapter } from "./business-ports/ledger";

type AuthorizedStoredFileRecord = typeof storedFiles.$inferSelect;

export interface AuthorizedFileRepository {
  findForLedger(ledgerId: string, fileId: string): Promise<AuthorizedStoredFileRecord | null>;
  findForUser(userId: string, fileId: string): Promise<AuthorizedStoredFileRecord | null>;
}

function authorizedFileQuery() {
  return db
    .select({ file: storedFiles })
    .from(storedFiles)
    .innerJoin(ledgers, and(eq(ledgers.id, storedFiles.ledgerId), isNull(ledgers.deletedAt)))
    .innerJoin(
      revisionFiles,
      and(
        eq(revisionFiles.ledgerId, storedFiles.ledgerId),
        eq(revisionFiles.storedFileId, storedFiles.id)
      )
    )
    .innerJoin(
      sourceDocumentRevisions,
      and(
        eq(sourceDocumentRevisions.ledgerId, revisionFiles.ledgerId),
        eq(sourceDocumentRevisions.id, revisionFiles.revisionId)
      )
    )
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.ledgerId, sourceDocumentRevisions.ledgerId),
        eq(sourceDocuments.id, sourceDocumentRevisions.sourceDocumentId)
      )
    );
}

export const postgresAuthorizedFileRepository: AuthorizedFileRepository = {
  async findForLedger(ledgerId, fileId) {
    const rows = await authorizedFileQuery()
      .where(
        and(
          eq(storedFiles.ledgerId, ledgerId),
          eq(storedFiles.id, fileId),
          isNotNull(storedFiles.finalizedAt),
          isNull(storedFiles.deletedAt),
          isNull(sourceDocuments.deletedAt)
        )
      )
      .limit(1);
    return rows[0]?.file ?? null;
  },
  async findForUser(userId, fileId) {
    const ledgerId = getCoupleConfig()?.ledgerId;
    if (ledgerId == null || !(await postgresLedgerAdapter.canAccess(ledgerId, userId))) return null;
    const rows = await authorizedFileQuery()
      .where(
        and(
          eq(storedFiles.ledgerId, ledgerId),
          eq(storedFiles.id, fileId),
          isNotNull(storedFiles.finalizedAt),
          isNull(storedFiles.deletedAt),
          isNull(sourceDocuments.deletedAt)
        )
      )
      .limit(1);
    return rows[0]?.file ?? null;
  },
};
