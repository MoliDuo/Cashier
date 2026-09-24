import type { StaleSourceDocumentVersionError } from "@/lib/errors";
import type { VersionedCommandResult } from "../contracts";

/** Maps a caught {@link StaleSourceDocumentVersionError} to the stale branch of a `VersionedCommandResult`. */
export function staleVersionedCommandResult<T>(
  error: StaleSourceDocumentVersionError
): Extract<VersionedCommandResult<T>, { ok: false }> {
  return {
    ok: false,
    reason: "stale",
    sourceDocumentId: error.sourceDocumentId,
    expectedVersion: error.expectedVersion,
    currentVersion: error.currentVersion,
  };
}
