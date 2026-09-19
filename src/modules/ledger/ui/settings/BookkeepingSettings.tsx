"use client";

import type {
  EntryCategory,
  EntryCategoryWithCount,
  Ledger,
  SaveEntryCategoriesInput,
  Settings,
} from "@/modules/ledger/contracts";
import { useTranslations } from "next-intl";
import { CurrencySection } from "../CurrencySection";
import { CategorySection } from "../CategorySection";
import { SettingsField } from "./SettingsField";
import { SettingsSection } from "./SettingsSection";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AI_LANGUAGES } from "@/config/languages";
import { SettingsSectionActions } from "./SettingsSectionActions";
import { useEffect, useMemo, useState } from "react";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";

interface BookkeepingSettingsProps {
  ledgerId: string;
  settings: Settings;
  categories: EntryCategoryWithCount[];
  uncategorizedCount: number;
  onUpdateSettings: (data: Partial<Settings>) => Promise<Ledger>;
  onSaveCategories: (input: SaveEntryCategoriesInput) => Promise<EntryCategory[]>;
  onReloadCategories?: () => Promise<EntryCategory[]>;
  generatingCategoryIds: Set<string>;
  failedCategoryIds: Set<string>;
  onRetryMetadata: (id: string) => void;
  isSavingCategories: boolean;
  onGoToDetails?: (validCategoryIds: readonly string[]) => void;
}

export function BookkeepingSettings({
  ledgerId,
  settings,
  categories,
  uncategorizedCount,
  onUpdateSettings,
  onSaveCategories,
  onReloadCategories,
  generatingCategoryIds,
  failedCategoryIds,
  onRetryMetadata,
  isSavingCategories,
  onGoToDetails,
}: BookkeepingSettingsProps) {
  const t = useTranslations("Settings");
  const incoming = useMemo(() => normalizeBookkeepingSettings(settings), [settings]);
  const [server, setServer] = useState(incoming);
  const [draft, setDraft] = useState(incoming);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [serverChanged, setServerChanged] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Set<BookkeepingField>>(new Set());
  const dirty = !bookkeepingSettingsEqual(server, draft);

  if (!bookkeepingSettingsEqual(server, incoming)) {
    const touchedServerFieldsChanged = bookkeepingFields.some(
      (field) => touchedFields.has(field) && !bookkeepingFieldEqual(field, server, incoming)
    );
    setServer(incoming);
    setDraft((current) => rebaseBookkeepingDraft(current, incoming, touchedFields));
    setServerChanged((current) => current || touchedServerFieldsChanged);
  }

  useEffect(() => {
    const key = "settings:bookkeeping";
    useUnsavedChangesStore.getState().setDirty(key, dirty);
    return () => useUnsavedChangesStore.getState().setDirty(key, false);
  }, [dirty]);

  const updateDraft = (patch: Partial<Settings>) => {
    setDraft((current) => normalizeBookkeepingSettings({ ...current, ...patch }));
    setTouchedFields((current) => {
      const next = new Set(current);
      for (const field of bookkeepingFields) {
        if (field in patch) next.add(field);
      }
      return next;
    });
    setError(null);
  };

  const handleSave = async () => {
    if (serverChanged) return;
    if (!draft.currencies.includes(draft.mainCurrency)) {
      setStatus("error");
      setError(t("mainCurrencyMustBeEnabled"));
      return;
    }

    const patch = buildBookkeepingPatch(server, draft, touchedFields);
    if (Object.keys(patch).length === 0) {
      setTouchedFields(new Set());
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const savedLedger = await onUpdateSettings(patch);
      const nextServer = normalizeBookkeepingSettings(savedLedger.settings);
      setServer(nextServer);
      setDraft(nextServer);
      setTouchedFields(new Set());
      setStatus("idle");
      setServerChanged(false);
    } catch {
      setStatus("error");
      setError(t("updateFailed"));
    }
  };

  const handleCancel = () => {
    setDraft(server);
    setTouchedFields(new Set());
    setStatus("idle");
    setError(null);
    setServerChanged(false);
  };

  return (
    <SettingsSection
      title={t("bookkeepingRules")}
      actions={
        <SettingsSectionActions
          dirty={dirty}
          pending={status === "saving"}
          error={error}
          serverChanged={serverChanged}
          saveDisabled={serverChanged}
          onSave={() => void handleSave()}
          onCancel={handleCancel}
        />
      }
    >
      <SettingsField title={t("collapseEntries")}>
        <Switch
          aria-label={t("collapseEntries")}
          checked={draft.collapseEntriesDefault}
          onCheckedChange={(checked) => updateDraft({ collapseEntriesDefault: checked })}
          disabled={status === "saving"}
        />
      </SettingsField>
      <SettingsField title={t("aiLanguage")}>
        <Select
          value={draft.aiLanguage}
          onValueChange={(value) => updateDraft({ aiLanguage: value })}
          disabled={status === "saving"}
        >
          <SelectTrigger aria-label={t("aiLanguage")} className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {AI_LANGUAGES.map((lang) => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsField>
      <SettingsField title={t("aiPrompt")} stacked>
        <Textarea
          value={draft.aiCustomPrompt}
          name="aiCustomPrompt"
          autoComplete="off"
          onChange={(event) => updateDraft({ aiCustomPrompt: event.target.value })}
          disabled={status === "saving"}
          aria-label={t("aiPrompt")}
          placeholder={t("aiPromptPlaceholder")}
          maxLength={4000}
          className="min-h-[100px] w-full resize-y"
        />
      </SettingsField>
      <CurrencySection
        settings={draft}
        onUpdateSettings={updateDraft}
        disabled={status === "saving"}
      />
      <CategorySection
        ledgerId={ledgerId}
        categories={categories}
        uncategorizedCount={uncategorizedCount}
        onSaveCategories={onSaveCategories}
        {...(onReloadCategories == null ? {} : { onReloadCategories })}
        generatingCategoryIds={generatingCategoryIds}
        failedCategoryIds={failedCategoryIds}
        onRetryMetadata={onRetryMetadata}
        isSaving={isSavingCategories}
        {...(onGoToDetails == null ? {} : { onGoToDetails })}
      />
    </SettingsSection>
  );
}

export type { BookkeepingSettingsProps };

interface BookkeepingDraft {
  mainCurrency: string;
  currencies: string[];
  collapseEntriesDefault: boolean;
  aiLanguage: string;
  aiCustomPrompt: string;
}

type BookkeepingField = keyof BookkeepingDraft;
const bookkeepingFields: readonly BookkeepingField[] = [
  "mainCurrency",
  "currencies",
  "collapseEntriesDefault",
  "aiLanguage",
  "aiCustomPrompt",
];

function normalizeBookkeepingSettings(settings: BookkeepingDraft): BookkeepingDraft {
  return {
    mainCurrency: settings.mainCurrency,
    currencies: [...settings.currencies],
    collapseEntriesDefault: settings.collapseEntriesDefault,
    aiLanguage: settings.aiLanguage,
    aiCustomPrompt: settings.aiCustomPrompt,
  };
}

function bookkeepingSettingsEqual(left: BookkeepingDraft, right: BookkeepingDraft): boolean {
  return (
    left.mainCurrency === right.mainCurrency &&
    left.collapseEntriesDefault === right.collapseEntriesDefault &&
    left.aiLanguage === right.aiLanguage &&
    left.aiCustomPrompt === right.aiCustomPrompt &&
    left.currencies.length === right.currencies.length &&
    left.currencies.every((currency, index) => currency === right.currencies[index])
  );
}

function buildBookkeepingPatch(
  server: BookkeepingDraft,
  draft: BookkeepingDraft,
  touchedFields: ReadonlySet<BookkeepingField>
): Partial<Settings> {
  const patch: Partial<Settings> = {};
  if (touchedFields.has("mainCurrency") && server.mainCurrency !== draft.mainCurrency) {
    patch.mainCurrency = draft.mainCurrency;
  }
  if (
    touchedFields.has("collapseEntriesDefault") &&
    server.collapseEntriesDefault !== draft.collapseEntriesDefault
  ) {
    patch.collapseEntriesDefault = draft.collapseEntriesDefault;
  }
  if (
    touchedFields.has("currencies") &&
    (server.currencies.length !== draft.currencies.length ||
      server.currencies.some((currency, index) => currency !== draft.currencies[index]))
  ) {
    patch.currencies = draft.currencies;
  }
  if (touchedFields.has("aiLanguage") && server.aiLanguage !== draft.aiLanguage) {
    patch.aiLanguage = draft.aiLanguage;
  }
  if (touchedFields.has("aiCustomPrompt") && server.aiCustomPrompt !== draft.aiCustomPrompt) {
    patch.aiCustomPrompt = draft.aiCustomPrompt;
  }
  return patch;
}

function bookkeepingFieldEqual(
  field: BookkeepingField,
  left: BookkeepingDraft,
  right: BookkeepingDraft
): boolean {
  if (field !== "currencies") return left[field] === right[field];
  return (
    left.currencies.length === right.currencies.length &&
    left.currencies.every((currency, index) => currency === right.currencies[index])
  );
}

function rebaseBookkeepingDraft(
  draft: BookkeepingDraft,
  incoming: BookkeepingDraft,
  touchedFields: ReadonlySet<BookkeepingField>
): BookkeepingDraft {
  return {
    mainCurrency: touchedFields.has("mainCurrency") ? draft.mainCurrency : incoming.mainCurrency,
    currencies: touchedFields.has("currencies") ? draft.currencies : incoming.currencies,
    collapseEntriesDefault: touchedFields.has("collapseEntriesDefault")
      ? draft.collapseEntriesDefault
      : incoming.collapseEntriesDefault,
    aiLanguage: touchedFields.has("aiLanguage") ? draft.aiLanguage : incoming.aiLanguage,
    aiCustomPrompt: touchedFields.has("aiCustomPrompt")
      ? draft.aiCustomPrompt
      : incoming.aiCustomPrompt,
  };
}
