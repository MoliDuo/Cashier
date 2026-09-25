import type { EntryEditData } from "@/modules/source-document/types";

export interface SourceDocPendingChanges {
  title?: string;
  documentDate?: string;
}

export type EntriesPendingChanges = Record<string, Partial<EntryEditData>>;

export interface PendingChanges {
  sourceDoc: SourceDocPendingChanges;
  entries: EntriesPendingChanges;
}
