"use client";

import type {
  BookDto,
  CreatedServiceCredentialDto,
  ServiceCredential,
} from "@/modules/ledger/contracts";
import { useTranslations } from "next-intl";
import { EmailSettings } from "./EmailSettings";
import { PasswordForm } from "@/modules/auth/ui/PasswordForm";
import { ServiceCredentialSection } from "../ServiceCredentialSection";
import { SettingsField } from "./SettingsField";
import { SettingsSection } from "./SettingsSection";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface AccountSettingsProps {
  /** The account's login addresses, hydrated by the page bootstrap. */
  initialEmails: readonly string[];
  hasPassword: boolean;
  passwordUpdatedAt: string | null;
  credentials: ServiceCredential[];
  isPending: boolean;
  books: readonly BookDto[];
  onCreateCredential: (input: {
    name: string;
    bookId: string;
  }) => Promise<CreatedServiceCredentialDto>;
  onSetCredentialBook: (id: string, bookId: string) => Promise<void>;
  onDeleteCredential: (id: string) => Promise<void>;
  onCredentialDialogClose: () => void;
  onSignOut: () => void | Promise<void>;
  onRequireReauthentication: () => void | Promise<void>;
  onCredentialsChanged: () => void | Promise<void>;
}

export function AccountSettings({
  initialEmails,
  hasPassword,
  passwordUpdatedAt,
  credentials,
  isPending,
  books,
  onCreateCredential,
  onSetCredentialBook,
  onDeleteCredential,
  onCredentialDialogClose,
  onSignOut,
  onRequireReauthentication,
  onCredentialsChanged,
}: AccountSettingsProps) {
  const t = useTranslations("Settings");
  const ta = useTranslations("Settings.Account");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);

  return (
    <SettingsSection title={t("account")}>
      <EmailSettings
        initialEmails={initialEmails}
        onRequireReauthentication={onRequireReauthentication}
        onCredentialsChanged={onCredentialsChanged}
      />

      <SettingsField title={ta("passwordSection")} description={ta("passwordSectionDesc")}>
        <PasswordForm
          hasPassword={hasPassword}
          passwordUpdatedAt={passwordUpdatedAt}
          onRequireReauthentication={onRequireReauthentication}
          onCredentialsChanged={onCredentialsChanged}
        />
      </SettingsField>
      <ServiceCredentialSection
        credentials={credentials}
        books={books}
        onCreateCredential={onCreateCredential}
        onSetCredentialBook={onSetCredentialBook}
        onDeleteCredential={onDeleteCredential}
        onCredentialDialogClose={onCredentialDialogClose}
      />
      <SettingsField title={t("signOut")}>
        <Button
          variant="outline"
          disabled={isPending || isSigningOut}
          onClick={() => setSignOutConfirmOpen(true)}
        >
          {t("signOut")}
        </Button>
        <ConfirmDialog
          open={signOutConfirmOpen}
          onOpenChange={setSignOutConfirmOpen}
          title={t("signOutConfirmTitle")}
          description={t("signOutConfirmDescription")}
          confirmLabel={t("signOut")}
          onConfirm={async () => {
            if (isSigningOut) return false;
            setIsSigningOut(true);
            try {
              await onSignOut();
              return true;
            } finally {
              setIsSigningOut(false);
            }
          }}
        />
      </SettingsField>
    </SettingsSection>
  );
}

export type { AccountSettingsProps };
