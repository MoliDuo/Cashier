"use client";
import { useTranslations } from "next-intl";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import {
  createServiceCredentialAction,
  deleteServiceCredentialAction,
  updateServiceCredentialAction,
} from "@/modules/ledger/server-actions/credentials";
import type { CreatedServiceCredential, ServiceCredential } from "@/modules/ledger/contracts";
import { toast } from "sonner";

export function useCredentialMutations(ledgerId: string) {
  const t = useTranslations("Settings");
  const tCredentials = useTranslations("ServiceCredentials");
  const tCommon = useTranslations("Common");
  const createCredential = useLedgerMutation<
    CreatedServiceCredential,
    { name: string; bookId: string }
  >(ledgerId, {
    invalidates: ["credentials"],
    mutationFn: (input) => createServiceCredentialAction(ledgerId, input),
    successMessage: t("credentialCreated"),
    errorMessage: null,
    onError: (error) => {
      const code = (error as Error & { code?: unknown }).code;
      toast.error(code === "CONFLICT" ? tCredentials("maxActive") : t("createFailed"));
    },
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
  });

  const setCredentialBook = useLedgerMutation<ServiceCredential, { id: string; bookId: string }>(
    ledgerId,
    {
      invalidates: ["credentials"],
      mutationFn: (input) =>
        updateServiceCredentialAction(ledgerId, input.id, { bookId: input.bookId }),
      successMessage: t("credentialBookChanged"),
      errorMessage: t("credentialBookChangeFailed"),
      invalidationErrorMessage: tCommon("savedRefreshFailed"),
    }
  );

  const deleteCredential = useLedgerMutation<void, string>(ledgerId, {
    invalidates: ["credentials"],
    mutationFn: (id) => deleteServiceCredentialAction(ledgerId, id),
    successMessage: t("credentialDeleted"),
    errorMessage: t("deleteFailed"),
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
  });

  return {
    createCredential,
    setCredentialBook,
    deleteCredential,
  };
}
