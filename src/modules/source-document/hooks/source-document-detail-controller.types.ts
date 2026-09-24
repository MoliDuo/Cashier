import type { useTranslations } from "next-intl";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type {
  PartialBatchCommandResult,
  SourceDocument,
  SplitSourceDocumentInput,
  SplitSourceDocumentResultDto,
} from "@/modules/source-document/contracts";
import type { PendingChanges } from "@/modules/source-document/detail-types";
import type { AddEntryData } from "./useSourceDocumentDetailMutations";

export interface UseSourceDocumentDetailControllerOptions {
  ledgerId: string;
  sourceDocument: SourceDocument | null;
  ledgerEntries: LedgerEntry[];
  open: boolean;
  isCancelling: boolean;
  externalUnsaved: boolean;
  onDiscardExternalUnsaved: () => void;
  onClose: () => void;
  onReload?: (() => Promise<void>) | undefined;
  onSaveAll?:
    | ((
        input: { expectedVersion: number; changes: PendingChanges },
        onCommitted?: () => void
      ) => Promise<void>)
    | undefined;
  onSplit?:
    | ((
        input: Omit<SplitSourceDocumentInput, "sourceDocumentId">
      ) => Promise<SplitSourceDocumentResultDto>)
    | undefined;
  onBatchUpdate: (
    ids: string[],
    data: {
      categoryId?: string | null;
      currency?: string;
      entryDate?: string;
      description?: string;
    }
  ) => Promise<{ affectedCount: number } | undefined>;
  onBatchDeleteEntries: (
    ids: string[],
    onCommitted?: (result: PartialBatchCommandResult) => void
  ) => Promise<PartialBatchCommandResult>;
  onAddEntry?: ((data: AddEntryData) => Promise<void>) | undefined;
  onDeleteEntry?: ((entryId: string, onCommitted?: () => void) => Promise<void>) | undefined;
  onDelete?: ((onCommitted?: () => void) => void | Promise<void>) | undefined;
  onCancelProcessing?: (() => Promise<void>) | undefined;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}
