/** The record's own fields the detail sheet writes, each on its own. */
export interface DocumentPatch {
  title?: string;
  documentDate?: string;
}

/** Fields collected by the "add entry" dialog for a new ledger entry. */
export interface AddEntryData {
  itemName: string;
  amount: number;
  currency?: string;
  categoryId?: string;
  description?: string | null;
}
