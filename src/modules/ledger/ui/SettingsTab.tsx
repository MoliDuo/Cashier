"use client";
import type { EntryCategoryWithCount, Ledger } from "@/modules/ledger/contracts";
import { usePathname } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { BookkeepingSettings } from "./settings/BookkeepingSettings";
import { AccountSettings } from "./settings/AccountSettings";
import { BookSettings } from "./settings/BookSettings";
import { SettingsSection } from "./settings/SettingsSection";
import { SettingsField } from "./settings/SettingsField";
import { useCategoryMutations } from "@/modules/ledger/hooks/useCategoryMutations";
import { useCredentialMutations } from "@/modules/ledger/hooks/useCredentialMutations";
import { useBooks } from "@/modules/ledger/hooks/useBooks";
import { useLedgerSettings } from "@/modules/ledger/hooks/useLedgerSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { signOutAction } from "@/modules/auth/server-actions/sign-in";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchEntryCategories } from "@/modules/ledger/queries";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import type { BookDto } from "@/modules/ledger/contracts";

interface SettingsTabProps {
  ledger: Ledger;
  initialCategories: EntryCategoryWithCount[];
  /** The switcher's books, hydrated by the page bootstrap. */
  initialBooks: readonly BookDto[];
  userEmail?: string;
  hasPassword?: boolean;
  passwordUpdatedAt?: string | null;
  onGoToDetails?: (validCategoryIds: readonly string[]) => void;
}

export function SettingsTab({
  ledger,
  initialCategories,
  initialBooks,
  userEmail,
  hasPassword = false,
  passwordUpdatedAt = null,
  onGoToDetails,
}: SettingsTabProps) {
  const pathname = usePathname();
  const t = useTranslations("Settings");
  const tQueryError = useTranslations("LedgerQueryError");
  const { theme, setTheme } = useTheme();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [metadataPollingSession, setMetadataPollingSession] = useState(0);

  // Use extracted hooks - ledger is reactive and will update with optimistic updates
  const {
    ledger: reactiveLedger,
    categories,
    uncategorizedCount,
    credentials,
    updateLedgerMutation,
    isPending,
    settingsQueryStatus,
  } = useLedgerSettings({ ledger, initialCategories, metadataPollingSession });

  // Use reactive ledger for settings that need optimistic updates
  const settingsLedger = reactiveLedger || ledger;

  const { saveCategories, generatingCategoryIds, failedCategoryIds, retryCategoryMetadata } =
    useCategoryMutations({
      onMetadataGenerated: () => setMetadataPollingSession((session) => session + 1),
    });

  const { createCredential, setCredentialBook, deleteCredential } = useCredentialMutations();
  // The book list is one query: the 分账 section writes it and the API-key
  // pickers read it, so a rename or reorder lands everywhere at once.
  const { books } = useBooks({ initialBooks });
  const reloadCategories = async () => {
    const latest = await fetchEntryCategories();
    queryClient.setQueryData(queryKeys.entryCategories(), latest);
    return latest;
  };

  // Theme key mapping for translations
  const themeLabel = (themeName: "system" | "light" | "dark") => {
    switch (themeName) {
      case "system":
        return t("themeAuto");
      case "light":
        return t("themeLight");
      case "dark":
        return t("themeDark");
    }
  };
  const signOutTo = async (callbackUrl: string) => {
    try {
      await signOutAction();
    } finally {
      // A full page load, not a client-side push: the old session's cached
      // ledger data must not survive into the login page.
      window.location.assign(callbackUrl);
    }
  };

  const handleSignOut = async () => {
    await signOutTo("/login");
  };

  const handleRequireReauthentication = async () => {
    const query = searchParams.toString();
    const currentPath = query === "" ? pathname : `${pathname}?${query}`;
    await signOutTo(`/login?notice=reauth_required&callbackUrl=${encodeURIComponent(currentPath)}`);
  };

  const handleCredentialsChanged = async () => {
    await signOutTo("/login?notice=credentials_changed");
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4 overflow-x-clip">
      {settingsQueryStatus === "error" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border border-danger/30 bg-danger/10 px-3 py-2 text-sm"
        >
          <span>{tQueryError("description")}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void queryClient.refetchQueries({
                type: "active",
                predicate: ({ queryKey: key }) =>
                  key[0] === "ledger" &&
                  (key.length === 1 ||
                    key[1] === "categories" ||
                    key[1] === "settings" ||
                    key[1] === "books"),
              });
            }}
          >
            <RefreshCw className="size-4" />
            {tQueryError("retry")}
          </Button>
        </div>
      )}
      <SettingsSection title={t("appearance")}>
        <SettingsField title={t("theme")}>
          <Select value={theme ?? "system"} onValueChange={setTheme}>
            <SelectTrigger aria-label={t("theme")} className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["system", "light", "dark"] as const).map((themeName) => (
                <SelectItem key={themeName} value={themeName}>
                  {themeLabel(themeName)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsField>
      </SettingsSection>

      <BookSettings />

      <BookkeepingSettings
        settings={settingsLedger.settings}
        categories={categories}
        uncategorizedCount={uncategorizedCount}
        onUpdateSettings={(data) => updateLedgerMutation.mutateAsync(data)}
        onSaveCategories={(input) => saveCategories.mutateAsync(input)}
        onReloadCategories={reloadCategories}
        generatingCategoryIds={generatingCategoryIds}
        failedCategoryIds={failedCategoryIds}
        onRetryMetadata={retryCategoryMetadata}
        isSavingCategories={saveCategories.isPending}
        {...(onGoToDetails == null ? {} : { onGoToDetails })}
      />

      {/* Removing a login email deletes every session server-side, so every device
          was signed out, not only this one; EmailSettings announces that before
          leaving and then reuses the same credentials-changed sign-out. */}
      <AccountSettings
        {...(userEmail !== undefined ? { userEmail } : {})}
        hasPassword={hasPassword}
        passwordUpdatedAt={passwordUpdatedAt}
        credentials={credentials ?? []}
        isPending={isPending}
        books={books ?? initialBooks}
        onCreateCredential={(input) => createCredential.mutateAsync(input)}
        onSetCredentialBook={(id, bookId) =>
          setCredentialBook.mutateAsync({ id, bookId }).then(() => undefined)
        }
        onDeleteCredential={(id) => deleteCredential.mutateAsync(id)}
        onCredentialDialogClose={createCredential.reset}
        onSignOut={handleSignOut}
        onRequireReauthentication={handleRequireReauthentication}
        onCredentialsChanged={handleCredentialsChanged}
        onAllSessionsEnded={handleCredentialsChanged}
      />
    </div>
  );
}
