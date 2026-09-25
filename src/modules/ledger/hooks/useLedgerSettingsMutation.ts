"use client";

import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { updateLedgerSettingsAction } from "@/modules/ledger/server-actions/update";
import type { Ledger, UpdateLedgerActionErrorCode } from "@/modules/ledger/contracts";
import type { UpdateLedgerInput } from "@/modules/ledger/contract-schemas";
import { omitUndefinedProperties } from "@/lib/validation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

/** The settings the update action accepts, so the two cannot drift apart. */
export type UpdateLedgerData = UpdateLedgerInput["settings"];

interface UseLedgerSettingsMutationParams {
  expectedUpdatedAt: string;
  successMessage: string;
  errorMessage: string;
}

export function useLedgerSettingsMutation({
  expectedUpdatedAt,
  successMessage,
  errorMessage,
}: UseLedgerSettingsMutationParams) {
  const t = useTranslations("Settings");
  const queryClient = useQueryClient();
  const translateError = (code: UpdateLedgerActionErrorCode) => {
    switch (code) {
      case "unsupported_currency":
        return t("unsupportedCurrency");
      case "validation_failed":
        return t("validationFailed");
      case "conflict":
        return t("updateConflict");
      case "unexpected":
        return t("updateFailed");
    }
  };

  return useLedgerMutation<Ledger, UpdateLedgerData>({
    invalidates: (_ledger, data) =>
      data.mainCurrency === undefined ? ["settings"] : ["settings", "documents", "stats"],
    mutationFn: async (data) => {
      const result = await updateLedgerSettingsAction({
        expectedUpdatedAt,
        settings: omitUndefinedProperties(data),
      });
      if (!result.ok) throw new Error(translateError(result.code));
      return result.ledger;
    },
    successMessage,
    errorMessage: null,
    onSuccess: (savedLedger) => {
      queryClient.setQueryData(queryKeys.ledger(), savedLedger);
    },
    onError: (error) => toast.error(error.message || errorMessage),
  });
}
