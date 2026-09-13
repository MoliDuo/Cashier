import type { LedgerEntry } from "@/modules/ledger/contracts";
import type { SourceDocument } from "@/modules/source-document/contracts";
import type { useStreamSourceDocumentRecoveryMutations } from "@/modules/source-document/hooks/useStreamSourceDocumentRecoveryMutations";
import type { UnifiedStreamGroup } from "@/modules/source-document/stream-grouping";

export interface UnifiedStreamGroupProps {
  streamGroups: UnifiedStreamGroup[];
  mainCurrency: string;
  onViewLedgerEntry?: (entry: LedgerEntry) => void;
  onViewSourceDetail: (group: {
    sourceDocument: SourceDocument;
    ledgerEntries: LedgerEntry[];
  }) => void;
  onViewSourceDetailIntent?: (doc: SourceDocument) => void;
  onEditRetry?: (doc: SourceDocument) => void;
  onEditRetryIntent?: () => void;
  onDeleteSourceConfirm: (doc: SourceDocument) => void;
  isSelectionMode: boolean;
  selectedIds: string[];
  disableUnselected?: boolean;
  onToggleSelection: (id: string) => void;
  /** Selects or clears a whole day at once. Absent where nothing selects. */
  onSetGroupSelection?: (ids: readonly string[], selected: boolean) => void;
  noRecordsText: string;
  getItemProps: () => Record<string, unknown>;
  timeZone?: string;
  readOnly?: boolean;
  collapseEntriesDefault?: boolean;
  recovery?: ReturnType<typeof useStreamSourceDocumentRecoveryMutations>;
}

export type UnifiedStreamItem = UnifiedStreamGroup["items"][number];

export type RendererProps = Omit<UnifiedStreamGroupProps, "readOnly"> & {
  selectedIdSet: ReadonlySet<string>;
};

export type ControlledRendererProps = RendererProps & {
  getExpanded: (sourceDocumentId: string) => boolean;
  onExpandedChange: (sourceDocumentId: string, expanded: boolean) => void;
};
