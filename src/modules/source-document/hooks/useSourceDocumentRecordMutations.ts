"use client";
import { toast } from "sonner";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { useTranslations } from "next-intl";
import { SourceDocumentStaleCommandError } from "@/modules/source-document/command-results";
import type { DeleteSourceDocumentResultDto } from "@/modules/source-document/contracts";
import { useVersionedSourceDocumentMutation } from "./useVersionedSourceDocumentMutation";

interface UseSourceDocumentRecordMutationsOptions {
  id: string;
  /** Read fresh at submission time — never captured ahead of the actual click. */
  version: number | null;
  onClose: () => void;
}

export function useSourceDocumentRecordMutations({
  id,
  version,
  onClose,
}: UseSourceDocumentRecordMutationsOptions) {
  const tCommon = useTranslations("Common");
  const tDetail = useTranslations("SourceDocumentDetail");

  // -----------------------------------------------------------------------
  // Delete source document
  // -----------------------------------------------------------------------

  const deleteDocumentMutation = useVersionedSourceDocumentMutation<DeleteSourceDocumentResultDto>({
    refreshMode: "background",
    sourceDocumentId: id,
    expectedVersion: version,
    action: deleteSourceDocumentAction,
    successMessage: tCommon("deleteSuccess"),
    errorMessage: null,
    onError: (error) => {
      toast.error(
        error instanceof SourceDocumentStaleCommandError
          ? tDetail("actionContextChanged")
          : tCommon("deleteFailed")
      );
    },
    onSuccess: () => {
      onClose();
    },
  });

  return {
    deleteDocumentMutation,
  };
}
