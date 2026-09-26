import type { LedgerEntry } from "@/modules/ledger/contracts";
import { useState, useMemo, useCallback } from "react";
import { type EntryEditData } from "@/modules/source-document/types";
import type { SourceDocument } from "@/modules/source-document/contracts";
import type {
  PendingChanges,
  SourceDocPendingChanges,
} from "@/modules/source-document/detail-types";

interface UsePendingChangesOptions {
  sourceDocument: SourceDocument | null;
  ledgerEntries: LedgerEntry[];
}

export function usePendingChanges({ sourceDocument, ledgerEntries }: UsePendingChangesOptions) {
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({
    sourceDoc: {},
    entries: {},
  });

  const hasPendingChanges = useMemo(() => {
    const hasSourceDocChanges = Object.keys(pendingChanges.sourceDoc).length > 0;
    const hasEntryChanges = Object.keys(pendingChanges.entries).length > 0;
    return hasSourceDocChanges || hasEntryChanges;
  }, [pendingChanges]);

  const pendingChangesCount = useMemo(() => {
    let count = Object.keys(pendingChanges.sourceDoc).length;
    Object.values(pendingChanges.entries).forEach((changes) => {
      count += Object.keys(changes).length;
    });
    return count;
  }, [pendingChanges]);

  const handleSourceDocChange = useCallback(
    (changes: SourceDocPendingChanges) => {
      if (!sourceDocument) return;

      setPendingChanges((prev) => {
        const next = { ...prev.sourceDoc };
        for (const [key, value] of Object.entries(changes)) {
          const field = key as keyof typeof next;
          let originalValue: string | undefined;

          if (field === "title") {
            originalValue = sourceDocument.title ?? "";
          } else if (field === "documentDate") {
            originalValue = sourceDocument.documentDate?.split("T")[0] ?? "";
          }

          if (value === originalValue) {
            delete next[field];
          } else {
            next[field] = value;
          }
        }
        return { ...prev, sourceDoc: next };
      });
    },
    [sourceDocument]
  );

  const handleEntryChange = useCallback(
    (entryId: string, changes: Partial<EntryEditData>) => {
      const entry = ledgerEntries?.find((e) => e.id === entryId);
      if (!entry) return;

      setPendingChanges((prev) => {
        const entryChanges = { ...prev.entries[entryId] };

        for (const [key, value] of Object.entries(changes)) {
          const field = key as keyof EntryEditData;
          let originalValue: string | number | null | undefined;

          switch (field) {
            case "itemName":
              originalValue = entry.itemName;
              break;
            case "amount":
              originalValue = entry.amount;
              break;
            case "currency":
              originalValue = entry.currency;
              break;
            case "categoryId":
              originalValue = entry.categoryId;
              break;
            case "description":
              originalValue = entry.description;
              break;
            default:
              originalValue = undefined;
          }

          if (value === originalValue) {
            delete entryChanges[field];
          } else {
            (entryChanges as Record<string, unknown>)[field] = value;
          }
        }

        if (Object.keys(entryChanges).length === 0) {
          const { [entryId]: _, ...rest } = prev.entries;
          return { ...prev, entries: rest };
        }

        return { ...prev, entries: { ...prev.entries, [entryId]: entryChanges } };
      });
    },
    [ledgerEntries]
  );

  const resetChanges = useCallback(() => {
    setPendingChanges({ sourceDoc: {}, entries: {} });
  }, []);

  const restoreChanges = useCallback((changes: PendingChanges) => {
    setPendingChanges(changes);
  }, []);

  return {
    pendingChanges,
    hasPendingChanges,
    pendingChangesCount,
    handleSourceDocChange,
    handleEntryChange,
    discardAllChanges: resetChanges,
    resetChanges,
    restoreChanges,
  };
}
