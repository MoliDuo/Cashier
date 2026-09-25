"use client";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { useTranslations } from "next-intl";
import type { DeleteSourceDocumentResultDto } from "@/modules/source-document/contracts";
import { useSourceDocumentCommandMutation } from "./useSourceDocumentCommandMutation";

interface UseSourceDocumentRecordMutationsOptions {
  id: string;
  onClose: () => void;
}

export function useSourceDocumentRecordMutations({
  id,
  onClose,
}: UseSourceDocumentRecordMutationsOptions) {
  const tCommon = useTranslations("Common");

  // -----------------------------------------------------------------------
  // Delete source document
  // -----------------------------------------------------------------------

  const deleteDocumentMutation = useSourceDocumentCommandMutation<DeleteSourceDocumentResultDto>({
    refreshMode: "background",
    sourceDocumentId: id,
    action: deleteSourceDocumentAction,
    successMessage: tCommon("deleteSuccess"),
    errorMessage: tCommon("deleteFailed"),
    onSuccess: () => {
      onClose();
    },
  });

  return {
    deleteDocumentMutation,
  };
}
