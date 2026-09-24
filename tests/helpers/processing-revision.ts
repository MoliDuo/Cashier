import { db } from "@/lib/db";
import {
  createProcessingRevisionInTransaction,
  type CreatePendingRevisionInput,
} from "@/application/adapters/postgres/revisions";

/** Evidence-only fixture for tests that exercise processing jobs separately. */
export function createPendingRevision(input: CreatePendingRevisionInput) {
  return db.transaction((tx) => createProcessingRevisionInTransaction(tx, input));
}
