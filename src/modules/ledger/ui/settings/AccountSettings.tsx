"use client";

import type { CreatedServiceCredentialDto, ServiceCredential } from "@/modules/ledger/contracts";
import { useTranslations } from "next-intl";
import { EmailChangeForm } from "@/modules/auth/ui/EmailChangeForm";
import { PasswordForm } from "@/modules/auth/ui/PasswordForm";
import { ServiceCredentialSection } from "../ServiceCredentialSection";
import { SettingsField } from "./SettingsField";
import { SettingsSection } from "./SettingsSection";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface AccountSettingsProps {
  displayEmail: string;
  hasPassword: boolean;
  passwordUpdatedAt: string | null;
  credentials: ServiceCredential[];
  isPending: boolean;
  userId?: string;
  partnerUserId?: string;
  onEmailChanged: (email: string) => void;
  onCreateCredential: (name: string) => Promise<CreatedServiceCredentialDto>;
  onDeleteCredential: (id: string) => Promise<void>;
  onCredentialDialogClose: () => void;
  onSignOut: () => void | Promise<void>;
  onRequireReauthentication: () => void | Promise<void>;
  onCredentialsChanged: () => void | Promise<void>;
}

export function AccountSettings({
  displayEmail,
  hasPassword,
  passwordUpdatedAt,
  credentials,
  isPending,
  userId,
  partnerUserId,
  onEmailChanged,
  onCreateCredential,
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
      <SettingsField title={ta("emailSection")} description={ta("emailSectionDesc")}>
        <EmailChangeForm
          currentEmail={displayEmail}
          onChanged={onEmailChanged}
          onRequireReauthentication={onRequireReauthentication}
          onCredentialsChanged={onCredentialsChanged}
        />
      </SettingsField>
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
        {...(userId !== undefined ? { userId } : {})}
        {...(partnerUserId !== undefined ? { partnerUserId } : {})}
        onCreateCredential={onCreateCredential}
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
