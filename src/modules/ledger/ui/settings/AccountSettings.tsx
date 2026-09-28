"use client";

import type {
  BookDto,
  CreatedServiceCredentialDto,
  ServiceCredential,
} from "@/modules/ledger/contracts";
import { EmailSettings } from "./EmailSettings";
import { PasskeySettings } from "@/modules/auth/ui/PasskeySettings";
import { ServiceCredentialSection } from "../ServiceCredentialSection";
import { SettingsField } from "@/components/SettingsField";
import { SettingsSection } from "@/components/SettingsSection";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { settingsCopy } from "@/copy/settings";

interface AccountSettingsProps {
  /** The address this session signed in with, for the list's first frame. */
  userEmail?: string;
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
  /** Removing a login email ends every session, so each one signs in again. */
  onAllSessionsEnded: () => void | Promise<void>;
}

export function AccountSettings({
  userEmail,
  credentials,
  isPending,
  books,
  onCreateCredential,
  onSetCredentialBook,
  onDeleteCredential,
  onCredentialDialogClose,
  onSignOut,
  onRequireReauthentication,
  onAllSessionsEnded,
}: AccountSettingsProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);

  return (
    <>
      {/* API 密钥 saves on its own and binds each key to a 分账, so it is a card
          of its own right after them. */}
      <ServiceCredentialSection
        credentials={credentials}
        books={books}
        onCreateCredential={onCreateCredential}
        onSetCredentialBook={onSetCredentialBook}
        onDeleteCredential={onDeleteCredential}
        onCredentialDialogClose={onCredentialDialogClose}
      />
      {/* 账户 is how this person signs in — the emails, then the passkeys — and
          signing out closes it and the page. */}
      <SettingsSection title={settingsCopy.account}>
        <EmailSettings
          {...(userEmail !== undefined ? { userEmail } : {})}
          onRequireReauthentication={onRequireReauthentication}
          onAllSessionsEnded={onAllSessionsEnded}
        />
        <PasskeySettings onRequireReauthentication={onRequireReauthentication} />
        {/* The button sits on the heading row at every width, like 添加邮箱 and
            添加通行密钥, instead of dropping under its own label on a phone. */}
        <SettingsField
          title={settingsCopy.signOutHere}
          stacked
          actions={
            <Button
              variant="destructive"
              size="sm"
              disabled={isPending || isSigningOut}
              onClick={() => setSignOutConfirmOpen(true)}
            >
              {settingsCopy.signOut}
            </Button>
          }
        />
      </SettingsSection>
      <ConfirmDialog
        open={signOutConfirmOpen}
        onOpenChange={setSignOutConfirmOpen}
        title={settingsCopy.signOutConfirmTitle}
        description={settingsCopy.signOutConfirmDescription}
        confirmLabel={settingsCopy.signOut}
        variant="destructive"
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
    </>
  );
}

export type { AccountSettingsProps };
