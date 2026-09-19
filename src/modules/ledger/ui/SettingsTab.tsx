"use client";
import type { EntryCategoryWithCount, Ledger } from "@/modules/ledger/contracts";
import { useRouter, usePathname } from "@/i18n/routing";
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
import { useTranslations, useLocale } from "next-intl";
import { useTheme } from "next-themes";
import { UI_LANGUAGES } from "@/config/languages";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { updateUserPreferencesAction } from "@/modules/auth/server-actions/user-preferences";
import type { InterfaceLanguage } from "@/modules/auth/contracts";
import { SettingsSectionActions } from "./settings/SettingsSectionActions";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";
import { queryKeys } from "@/lib/query-keys";
import { getEntryCategoriesAction } from "@/modules/ledger/server-actions/categories";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import type { BookDto } from "@/modules/ledger/contracts";

interface SettingsTabProps {
  ledger: Ledger;
  initialCategories: EntryCategoryWithCount[];
  ledgerId: string;
  /** The switcher's books, hydrated by the page bootstrap. */
  initialBooks: readonly BookDto[];
  /**
   * The same list plus the archived rows, for the 分账 section. Absent when the
   * page was opened from the workspace, whose bootstrap only knows the live
   * books: a partial list must not seed the archived-inclusive query, or the
   * archived rows stay invisible for the whole stale window.
   */
  initialBooksIncludingArchived?: readonly BookDto[];
  /** The account's login addresses, hydrated by the page bootstrap. */
  initialEmails?: readonly string[];
  userEmail?: string;
  hasPassword?: boolean;
  passwordUpdatedAt?: string | null;
  interfaceLanguage?: InterfaceLanguage;
  onGoToDetails?: (validCategoryIds: readonly string[]) => void;
}

type AppearanceField = "theme" | "language";
const appearanceFields: readonly AppearanceField[] = ["theme", "language"];

export function SettingsTab({
  ledger,
  initialCategories,
  ledgerId,
  initialBooks,
  initialBooksIncludingArchived,
  initialEmails,
  userEmail,
  hasPassword = false,
  passwordUpdatedAt = null,
  interfaceLanguage = "auto",
  onGoToDetails,
}: SettingsTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations("Settings");
  const tQueryError = useTranslations("LedgerQueryError");
  const { theme, setTheme } = useTheme();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [appearanceServer, setAppearanceServer] = useState({
    theme: theme ?? "system",
    language: interfaceLanguage,
  });
  const [appearanceDraft, setAppearanceDraft] = useState(appearanceServer);
  const [appearanceTouched, setAppearanceTouched] = useState<Set<AppearanceField>>(new Set());
  const [appearanceStatus, setAppearanceStatus] = useState<"idle" | "saving" | "error">("idle");
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [appearanceServerChanged, setAppearanceServerChanged] = useState(false);
  const [metadataPollingSession, setMetadataPollingSession] = useState(0);
  const appearanceDirty =
    appearanceServer.theme !== appearanceDraft.theme ||
    appearanceServer.language !== appearanceDraft.language;

  const nextAppearanceServer = { theme: theme ?? "system", language: interfaceLanguage };
  if (
    nextAppearanceServer.theme !== appearanceServer.theme ||
    nextAppearanceServer.language !== appearanceServer.language
  ) {
    const touchedServerFieldsChanged = appearanceFields.some(
      (field) =>
        appearanceTouched.has(field) && appearanceServer[field] !== nextAppearanceServer[field]
    );
    setAppearanceServer(nextAppearanceServer);
    setAppearanceDraft((current) => ({
      theme: appearanceTouched.has("theme") ? current.theme : nextAppearanceServer.theme,
      language: appearanceTouched.has("language")
        ? current.language
        : nextAppearanceServer.language,
    }));
    setAppearanceServerChanged((current) => current || touchedServerFieldsChanged);
  }

  useEffect(() => {
    const key = "settings:appearance";
    useUnsavedChangesStore.getState().setDirty(key, appearanceDirty);
    return () => useUnsavedChangesStore.getState().setDirty(key, false);
  }, [appearanceDirty]);

  // Use extracted hooks - ledger is reactive and will update with optimistic updates
  const {
    ledger: reactiveLedger,
    categories,
    uncategorizedCount,
    credentials,
    updateLedgerMutation,
    isPending,
    settingsQueryStatus,
  } = useLedgerSettings({ ledgerId, ledger, initialCategories, metadataPollingSession });

  // Use reactive ledger for settings that need optimistic updates
  const settingsLedger = reactiveLedger || ledger;

  const { saveCategories, generatingCategoryIds, failedCategoryIds, retryCategoryMetadata } =
    useCategoryMutations(ledgerId, {
      onMetadataGenerated: () => setMetadataPollingSession((session) => session + 1),
    });

  const { createCredential, setCredentialBook, deleteCredential } =
    useCredentialMutations(ledgerId);
  // The book list is one query: the 分账 section writes it and the API-key
  // pickers read it, so a rename or reorder lands everywhere at once.
  const { books } = useBooks({ ledgerId, initialBooks });
  const reloadCategories = async () => {
    const latest = await getEntryCategoriesAction(ledgerId);
    queryClient.setQueryData(queryKeys.entryCategories(ledgerId), latest);
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
  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/login" });
  };

  const handleRequireReauthentication = async () => {
    const query = searchParams.toString();
    const currentPath = query === "" ? pathname : `${pathname}?${query}`;
    const callbackUrl = `/login?notice=reauth_required&callbackUrl=${encodeURIComponent(currentPath)}`;
    try {
      await signOut({ callbackUrl });
    } catch {
      window.location.assign(callbackUrl);
    }
  };

  const handleCredentialsChanged = async () => {
    const callbackUrl = "/login?notice=credentials_changed";
    try {
      await signOut({ callbackUrl });
    } catch {
      window.location.assign(callbackUrl);
    }
  };

  const handleSaveAppearance = async () => {
    if (!appearanceDirty || appearanceStatus === "saving" || appearanceServerChanged) return;
    setAppearanceStatus("saving");
    setAppearanceError(null);
    try {
      let savedLanguage = appearanceDraft.language;
      if (appearanceDraft.language !== appearanceServer.language) {
        const saved = await updateUserPreferencesAction({
          interfaceLanguage: appearanceDraft.language,
        });
        savedLanguage = saved.interfaceLanguage;
      }

      if (appearanceDraft.theme !== appearanceServer.theme) {
        setTheme(appearanceDraft.theme);
      }

      const savedAppearance = {
        theme: appearanceDraft.theme,
        language: savedLanguage,
      };
      setAppearanceServer(savedAppearance);
      setAppearanceDraft(savedAppearance);
      setAppearanceTouched(new Set());
      setAppearanceServerChanged(false);
      setAppearanceStatus("idle");

      if (savedLanguage !== appearanceServer.language) {
        const queryString = searchParams.toString();
        const query = queryString !== "" ? `?${queryString}` : "";
        if (savedLanguage === "auto") {
          document.cookie =
            "NEXT_LOCALE=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax";
          router.refresh();
        } else {
          document.cookie = `NEXT_LOCALE=${savedLanguage}; path=/; max-age=31536000; samesite=lax`;
          if (savedLanguage === locale) router.refresh();
          else router.push(`${pathname}${query}`, { locale: savedLanguage });
        }
      }
    } catch {
      setAppearanceStatus("error");
      setAppearanceError(t("uiLanguageSaveFailed"));
    }
  };

  const handleCancelAppearance = () => {
    setAppearanceDraft(appearanceServer);
    setAppearanceTouched(new Set());
    setAppearanceServerChanged(false);
    setAppearanceStatus("idle");
    setAppearanceError(null);
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
                  key[1] === ledgerId &&
                  (key.length === 2 ||
                    key[2] === "categories" ||
                    key[2] === "settings" ||
                    key[2] === "books"),
              });
            }}
          >
            <RefreshCw className="size-4" />
            {tQueryError("retry")}
          </Button>
        </div>
      )}
      <SettingsSection
        title={t("appearanceAndLanguage")}
        actions={
          <SettingsSectionActions
            dirty={appearanceDirty}
            pending={appearanceStatus === "saving"}
            error={appearanceError}
            serverChanged={appearanceServerChanged}
            saveDisabled={appearanceServerChanged}
            onSave={() => void handleSaveAppearance()}
            onCancel={handleCancelAppearance}
          />
        }
      >
        <SettingsField title={t("theme")}>
          <Select
            value={appearanceDraft.theme}
            onValueChange={(nextTheme) => {
              setAppearanceDraft((current) => ({ ...current, theme: nextTheme }));
              setAppearanceTouched((current) => new Set(current).add("theme"));
              setAppearanceError(null);
            }}
            disabled={appearanceStatus === "saving"}
          >
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
        <SettingsField title={t("uiLanguage")}>
          <Select
            value={appearanceDraft.language}
            onValueChange={(value) => {
              setAppearanceDraft((current) => ({
                ...current,
                language: value as InterfaceLanguage,
              }));
              setAppearanceTouched((current) => new Set(current).add("language"));
              setAppearanceError(null);
            }}
            disabled={appearanceStatus === "saving"}
          >
            <SelectTrigger aria-label={t("uiLanguage")} className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {UI_LANGUAGES.map((lang) => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.value === "auto" ? t("uiLanguageAuto") : lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsField>
      </SettingsSection>

      <BookSettings
        ledgerId={ledgerId}
        {...(initialBooksIncludingArchived !== undefined
          ? { initialBooks: initialBooksIncludingArchived }
          : {})}
      />

      <BookkeepingSettings
        ledgerId={ledgerId}
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

      {/* Removing a login email bumps auth_version server-side, so every device
          was signed out, not only this one; EmailSettings announces that before
          leaving and then reuses the same credentials-changed sign-out. */}
      <AccountSettings
        {...(initialEmails !== undefined ? { initialEmails } : {})}
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
