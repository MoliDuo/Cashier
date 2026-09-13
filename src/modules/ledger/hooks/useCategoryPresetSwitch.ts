"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { queryKeys } from "@/lib/query-keys";
import { getCategoryPreset, type CategoryPresetId } from "@/config/category-presets";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";
import type { ApplyCategoryPresetInput, EntryCategoryWithCount } from "@/modules/ledger/contracts";
import { applyCategoryPresetAction } from "@/modules/ledger/server-actions/categories";

/**
 * Where each existing category's entries land under the chosen preset.
 * `undefined` means the user has not decided yet, `null` means keep the
 * category as it is. An undecided row is the one thing that blocks confirming,
 * because a row left at a default would silently pile the preset on top of the
 * ledger instead of replacing anything.
 */
export type PresetMappingDraft = Record<string, number | null | undefined>;

export interface CategoryPresetSummary {
  /** Categories whose entries move into a preset category. */
  directCount: number;
  /** Categories the user chose to keep alongside the preset. */
  keepCount: number;
  unsetCount: number;
  /** Entries affected by the move. */
  entryCount: number;
}

const DEFAULT_PRESET_ID: CategoryPresetId = "default";

function suggestedMappings(
  presetId: CategoryPresetId,
  locale: string,
  categories: readonly EntryCategoryWithCount[]
): PresetMappingDraft {
  const indexByName = new Map(
    getCategoryPreset(presetId, locale).map((category, index) => [category.name, index])
  );
  return Object.fromEntries(
    categories.map((category) => [category.id, indexByName.get(category.name)])
  );
}

function summarize(
  categories: readonly EntryCategoryWithCount[],
  mappings: PresetMappingDraft
): CategoryPresetSummary {
  let directCount = 0;
  let keepCount = 0;
  let unsetCount = 0;
  let entryCount = 0;
  for (const category of categories) {
    const mapping = mappings[category.id];
    if (mapping === undefined) unsetCount += 1;
    else if (mapping === null) keepCount += 1;
    else {
      directCount += 1;
      entryCount += category.entryCount ?? 0;
    }
  }
  return { directCount, keepCount, unsetCount, entryCount };
}

function errorCode(error: Error): unknown {
  return typeof error === "object" && error != null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

interface UseCategoryPresetSwitchOptions {
  ledgerId: string;
  categories: EntryCategoryWithCount[];
  locale: string;
}

/**
 * Owns the preset dialog: the chosen preset, the mapping draft, and the switch
 * itself. The draft is derived from suggestions rather than typed in, so it is
 * never registered with the unsaved-changes guard — closing and reopening
 * reproduces it exactly.
 */
export function useCategoryPresetSwitch({
  ledgerId,
  categories,
  locale,
}: UseCategoryPresetSwitchOptions) {
  const t = useTranslations("Settings");
  const tCommon = useTranslations("Common");
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [presetId, setPresetId] = useState<CategoryPresetId>(DEFAULT_PRESET_ID);
  const [mappings, setMappings] = useState<PresetMappingDraft>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const preset = useMemo(() => getCategoryPreset(presetId, locale), [presetId, locale]);
  const summary = useMemo(() => summarize(categories, mappings), [categories, mappings]);
  // A switch that migrates nothing would only append the preset to the existing
  // set, which is not what the button offers.
  const canConfirm = summary.unsetCount === 0 && summary.directCount > 0;

  const mutation = useLedgerMutation<EntryCategoryWithCount[], ApplyCategoryPresetInput>(ledgerId, {
    invalidates: ["categories", "stats", "documents"],
    refreshMode: "background",
    mutationFn: (input) => applyCategoryPresetAction(ledgerId, input),
    successMessage: t("presetApplied"),
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.entryCategories(ledgerId), saved);
      setOpen(false);
      setConfirmOpen(false);
      setSaveError(null);
    },
    onError: (error) => {
      setConfirmOpen(false);
      setSaveError(errorCode(error) === "CONFLICT" ? t("updateConflict") : t("presetApplyFailed"));
    },
  });

  const choosePreset = useCallback(
    (nextPresetId: CategoryPresetId) => {
      setPresetId(nextPresetId);
      setMappings(suggestedMappings(nextPresetId, locale, categories));
      setSaveError(null);
    },
    [categories, locale]
  );

  const openDialog = useCallback(() => {
    setPresetId(DEFAULT_PRESET_ID);
    setMappings(suggestedMappings(DEFAULT_PRESET_ID, locale, categories));
    setSaveError(null);
    setOpen(true);
  }, [categories, locale]);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setConfirmOpen(false);
    setSaveError(null);
  }, []);

  const setMapping = useCallback((fromCategoryId: string, value: number | null | undefined) => {
    setMappings((current) => ({ ...current, [fromCategoryId]: value }));
    setSaveError(null);
  }, []);

  const confirm = useCallback(() => {
    // The revision comes from the live server rows, not the draft, so a change
    // made in the meantime surfaces as a conflict instead of a switch computed
    // from stale identities.
    void computeCategoryCollectionRevision(categories).then((expectedRevision) => {
      mutation.mutate({
        expectedRevision,
        presetId,
        locale,
        mappings: categories.map((category) => ({
          fromCategoryId: category.id,
          toPresetIndex: mappings[category.id] ?? null,
        })),
      });
    });
  }, [categories, locale, mappings, mutation, presetId]);

  return {
    open,
    openDialog,
    closeDialog,
    confirmOpen,
    setConfirmOpen,
    presetId,
    preset,
    mappings,
    setMapping,
    choosePreset,
    summary,
    canConfirm,
    isPending: mutation.isPending,
    saveError,
    confirm,
    categories,
  };
}

export type CategoryPresetSwitch = ReturnType<typeof useCategoryPresetSwitch>;
