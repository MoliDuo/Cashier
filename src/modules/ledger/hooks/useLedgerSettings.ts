"use client";
import type { EntryCategoryWithCount } from "@/modules/ledger/contracts";
import { useTranslations } from "next-intl";
import type { Ledger } from "@/modules/ledger/contracts";
import { useLedgerSettingsMutation } from "./useLedgerSettingsMutation";
import { useLedgerSettingsQueries } from "./useLedgerSettingsQueries";

interface UseLedgerSettingsParams {
  ledger: Ledger;
  initialCategories: EntryCategoryWithCount[];
  metadataPollingSession: number;
}

export function useLedgerSettings({
  ledger: initialLedger,
  initialCategories,
  metadataPollingSession,
}: UseLedgerSettingsParams) {
  const t = useTranslations("Settings");
  const { ledger, categories, uncategorizedCount, credentials, settingsQueryStatus } =
    useLedgerSettingsQueries({
      initialLedger,
      initialCategories,
      metadataPollingSession,
    });

  const updateLedgerMutation = useLedgerSettingsMutation({
    expectedUpdatedAt: ledger?.updatedAt ?? initialLedger.updatedAt,
    successMessage: t("updateSuccess"),
    errorMessage: t("updateFailed"),
  });

  return {
    ledger,
    categories,
    uncategorizedCount,
    credentials,
    updateLedgerMutation,
    isPending: updateLedgerMutation.isPending,
    settingsQueryStatus,
  };
}
