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
      // Two different conflicts reach here: the 20-key cap and a book that is
      // gone or archived. Reporting both as the cap hid the real reason the
      // reader could not add a key.
      if (code === "BOOK_UNAVAILABLE") toast.error(tCredentials("bookUnavailable"));
      else if (code === "CONFLICT") toast.error(tCredentials("maxActive"));
      else toast.error(t("createFailed"));
    },
  });

  const setCredentialBook = useLedgerMutation<ServiceCredential, { id: string; bookId: string }>(
    ledgerId,
    {
      invalidates: ["credentials"],
      mutationFn: (input) =>
        updateServiceCredentialAction(ledgerId, input.id, { bookId: input.bookId }),
      successMessage: t("credentialBookChanged"),
      errorMessage: t("credentialBookChangeFailed"),
    }
  );

  const deleteCredential = useLedgerMutation<void, string>(ledgerId, {
    invalidates: ["credentials"],
    mutationFn: (id) => deleteServiceCredentialAction(ledgerId, id),
    successMessage: t("credentialDeleted"),
    errorMessage: t("deleteFailed"),
  });

  return {
    createCredential,
    setCredentialBook,
    deleteCredential,
  };
}
