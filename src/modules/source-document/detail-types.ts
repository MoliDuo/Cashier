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

/** Fields collected by the "add entry" dialog for a new ledger entry. */
export interface AddEntryData {
  itemName: string;
  amount: number;
  currency?: string;
  categoryId?: string;
  description?: string | null;
}
