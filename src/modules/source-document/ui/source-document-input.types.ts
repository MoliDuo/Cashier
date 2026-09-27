import type { ReactNode } from "react";
import type { CreatedRecordResult } from "@/modules/source-document/contracts";

interface SourceDocumentInputBaseProps {
  bookId?: string;
  onSuccess?: (result: CreatedRecordResult) => void;
  onPendingChange?: (pending: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  timeZone?: string;
  /**
   * False when the form is mounted but not the visible tab. The switch between
   * AI and quick entry only hides the other form, so a running camera needs to
   * be told to stop rather than waiting for an unmount that never comes.
   */
  isActive?: boolean;
  /** Shown at the start of the form's footer, beside the submit — the book picker. */
  footerStart?: ReactNode;
  initialData?: {
    text?: string;
    images?: Array<{ data: string; mimeType: string; storedFileId?: string }>;
    entryDate?: string;
  };
}

export type SourceDocumentInputProps = SourceDocumentInputBaseProps &
  (
    | { mode?: "create"; sourceDocumentId?: never }
    | {
        mode: "retry";
        sourceDocumentId: string;
        initialData: NonNullable<SourceDocumentInputBaseProps["initialData"]>;
      }
  );

export type SourceDocumentInputInitialData = NonNullable<SourceDocumentInputProps["initialData"]>;
