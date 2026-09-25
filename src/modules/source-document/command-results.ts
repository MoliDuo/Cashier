import type { VersionedCommandResult } from "./contracts";

export interface SourceDocumentStaleTarget {
  sourceDocumentId: string;
  expectedVersion: number;
  currentVersion: number;
}

export class SourceDocumentStaleCommandError extends Error {
  readonly code = "SOURCE_DOCUMENT_STALE" as const;

  constructor(public readonly staleTargets: SourceDocumentStaleTarget[]) {
    super("Source document changed before the command completed");
    this.name = "SourceDocumentStaleCommandError";
  }
}

export function unwrapVersionedCommandResult<T>(result: VersionedCommandResult<T>): T {
  if (result.ok) return result.data;
  throw new SourceDocumentStaleCommandError([
    {
      sourceDocumentId: result.sourceDocumentId,
      expectedVersion: result.expectedVersion,
      currentVersion: result.currentVersion,
    },
  ]);
}
