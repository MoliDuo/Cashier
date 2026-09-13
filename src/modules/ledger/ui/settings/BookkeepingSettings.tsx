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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SettingsSectionActions } from "./SettingsSectionActions";
import { useEffect, useMemo, useState } from "react";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";

interface BookkeepingSettingsProps {
  ledgerId: string;
  settings: Settings;
  categories: EntryCategoryWithCount[];
  uncategorizedCount: number;
  deviceTimeZone: string | null;
  onUpdateSettings: (data: Partial<Settings>) => Promise<Ledger>;
  onSaveCategories: (input: SaveEntryCategoriesInput) => Promise<EntryCategory[]>;
  onReloadCategories?: () => Promise<EntryCategory[]>;
  generatingCategoryIds: Set<string>;
  failedCategoryIds: Set<string>;
  onRetryMetadata: (id: string) => void;
  isSavingCategories: boolean;
}

export function BookkeepingSettings({
  ledgerId,
  settings,
  categories,
  uncategorizedCount,
  deviceTimeZone,
  onUpdateSettings,
  onSaveCategories,
  onReloadCategories,
  generatingCategoryIds,
  failedCategoryIds,
  onRetryMetadata,
  isSavingCategories,
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
    <SettingsSection title={t("bookkeepingRules")}>
      <SettingsField title={t("collapseEntries")} description={t("collapseEntriesDesc")}>
        <Switch
          aria-label={t("collapseEntries")}
          checked={draft.collapseEntriesDefault}
          onCheckedChange={(checked) => updateDraft({ collapseEntriesDefault: checked })}
          disabled={status === "saving"}
        />
      </SettingsField>
      <SettingsField title={t("timeZone")} description={t("timeZoneDesc")}>
        <Select
          value={draft.timeZone ?? "auto"}
          onValueChange={(value) => updateDraft({ timeZone: value === "auto" ? null : value })}
          disabled={status === "saving"}
        >
          <SelectTrigger aria-label={t("timeZone")} className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="auto">
              {deviceTimeZone == null
                ? t("timeZoneAuto")
                : t("timeZoneAutoDetected", { timeZone: deviceTimeZone })}
            </SelectItem>
            {[
              "Asia/Shanghai",
              "Asia/Tokyo",
              "Asia/Singapore",
              "Europe/London",
              "Europe/Paris",
              "America/New_York",
              "America/Chicago",
              "America/Denver",
              "America/Los_Angeles",
              "Australia/Sydney",
              "UTC",
            ].map((timeZone) => (
              <SelectItem key={timeZone} value={timeZone}>
                {timeZone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsField>
      <CurrencySection
        settings={draft}
        onUpdateSettings={updateDraft}
        disabled={status === "saving"}
      />
      <SettingsSectionActions
        dirty={dirty}
        pending={status === "saving"}
        error={error}
        serverChanged={serverChanged}
        saveDisabled={serverChanged}
        onSave={() => void handleSave()}
        onCancel={handleCancel}
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
      />
    </SettingsSection>
  );
}

export type { BookkeepingSettingsProps };

interface BookkeepingDraft {
  mainCurrency: string;
  currencies: string[];
  collapseEntriesDefault: boolean;
  timeZone: string | null;
}

type BookkeepingField = keyof BookkeepingDraft;
const bookkeepingFields: readonly BookkeepingField[] = [
  "mainCurrency",
  "currencies",
  "collapseEntriesDefault",
  "timeZone",
];

function normalizeBookkeepingSettings(settings: BookkeepingDraft): BookkeepingDraft {
  return {
    mainCurrency: settings.mainCurrency,
    currencies: [...settings.currencies],
    collapseEntriesDefault: settings.collapseEntriesDefault,
    timeZone: settings.timeZone,
  };
}

function bookkeepingSettingsEqual(left: BookkeepingDraft, right: BookkeepingDraft): boolean {
  return (
    left.mainCurrency === right.mainCurrency &&
    left.collapseEntriesDefault === right.collapseEntriesDefault &&
    left.timeZone === right.timeZone &&
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
  if (touchedFields.has("timeZone") && server.timeZone !== draft.timeZone) {
    patch.timeZone = draft.timeZone;
  }
  if (
    touchedFields.has("currencies") &&
    (server.currencies.length !== draft.currencies.length ||
      server.currencies.some((currency, index) => currency !== draft.currencies[index]))
  ) {
    patch.currencies = draft.currencies;
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
    timeZone: touchedFields.has("timeZone") ? draft.timeZone : incoming.timeZone,
  };
}
