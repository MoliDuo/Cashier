"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { queryKeys } from "@/lib/query-keys";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";
import {
  CATEGORY_PRESET_IDS,
  getCategoryPreset,
  getPresetSemanticKey,
  type CategoryPresetId,
} from "@/config/category-presets";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";
import type {
  ApplyCategoryPresetInput,
  ApplyCategoryPresetResult,
  EntryCategoryWithCount,
} from "@/modules/ledger/contracts";
import { applyCategoryPresetAction } from "@/modules/ledger/server-actions/categories";

export type PresetMappingDraft = Record<string, number | null | undefined>;

export interface CategoryPresetSummary {
  directCount: number;
  keepCount: number;
  unsetCount: number;
  entryCount: number;
  createdCount: number;
  mergedCount: number;
}

const DEFAULT_PRESET_ID: CategoryPresetId = "default";
const RECOMMENDATIONS: Readonly<Record<string, string | undefined>> = {
  dining: "food-drink",
  household: "home",
  housing: "home",
  transport: "travel",
  healthcare: "health",
  memberships: "leisure",
  entertainment: "leisure",
  shopping: "other",
  clothing: "other",
  "personal-care": "other",
  "daily-life": "other",
  education: "other",
  gifts: "other",
  "food-drink": "dining",
  travel: "transport",
  health: "healthcare",
  leisure: "entertainment",
};

function categorySignature(categories: readonly EntryCategoryWithCount[]): string {
  return categories
    .map((category) => `${category.id}:${category.updatedAt}:${category.sortOrder}`)
    .join("|");
}

function matchingPreset(categories: readonly EntryCategoryWithCount[]): CategoryPresetId | null {
  const names = new Set(categories.map((category) => category.name));
  for (const presetId of CATEGORY_PRESET_IDS) {
    const presetNames = getCategoryPreset(presetId).map((category) => category.name);
    if (presetNames.length === names.size && presetNames.every((name) => names.has(name)))
      return presetId;
  }
  return null;
}

function suggestedMappings(
  presetId: CategoryPresetId,
  categories: readonly EntryCategoryWithCount[]
): PresetMappingDraft {
  const targets = getCategoryPreset(presetId);
  const indexByName = new Map(targets.map((category, index) => [category.name, index]));
  const indexByKey = new Map(targets.map((category, index) => [category.key, index]));
  return Object.fromEntries(
    categories.map((category) => {
      const sameName = indexByName.get(category.name);
      if (sameName != null) return [category.id, sameName];
      const semanticKey = getPresetSemanticKey(category.name);
      const recommendedKey = semanticKey == null ? undefined : RECOMMENDATIONS[semanticKey];
      const recommended = recommendedKey == null ? undefined : indexByKey.get(recommendedKey);
      if (recommended != null) return [category.id, recommended];
      return [category.id, (category.entryCount ?? 0) === 0 ? null : undefined];
    })
  );
}

function summarize(
  categories: readonly EntryCategoryWithCount[],
  mappings: PresetMappingDraft,
  presetCount: number
): CategoryPresetSummary {
  let directCount = 0;
  let keepCount = 0;
  let unsetCount = 0;
  let entryCount = 0;
  const targetCounts = new Map<number, number>();
  for (const category of categories) {
    const mapping = mappings[category.id];
    if (mapping === undefined) unsetCount += 1;
    else if (mapping === null) keepCount += 1;
    else {
      directCount += 1;
      entryCount += category.entryCount ?? 0;
      targetCounts.set(mapping, (targetCounts.get(mapping) ?? 0) + 1);
    }
  }
  return {
    directCount,
    keepCount,
    unsetCount,
    entryCount,
    createdCount: Math.max(0, presetCount - targetCounts.size),
    mergedCount: [...targetCounts.values()]
      .filter((value) => value > 1)
      .reduce((sum, value) => sum + value - 1, 0),
  };
}

function errorCode(error: Error): unknown {
  return "code" in error ? (error as { code?: unknown }).code : undefined;
}

interface UseCategoryPresetSwitchOptions {
  ledgerId: string;
  categories: EntryCategoryWithCount[];
}

export function useCategoryPresetSwitch({ ledgerId, categories }: UseCategoryPresetSwitchOptions) {
  const t = useTranslations("Settings");
  const tCommon = useTranslations("Common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardAction, setDiscardAction] = useState<"close" | "reload">("close");
  const [presetId, setPresetId] = useState<CategoryPresetId>(DEFAULT_PRESET_ID);
  const [drafts, setDrafts] = useState<Partial<Record<CategoryPresetId, PresetMappingDraft>>>({});
  const [snapshot, setSnapshot] = useState<{
    ledgerId: string;
    categories: EntryCategoryWithCount[];
    signature: string;
    revision: string;
    initialPresetId: CategoryPresetId;
    initialMappings: PresetMappingDraft;
  } | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyCategoryPresetResult | null>(null);
  const revisionRequestRef = useRef(0);

  const draftCategories = snapshot?.categories ?? categories;
  const preset = useMemo(() => getCategoryPreset(presetId), [presetId]);
  const mappings = useMemo(() => drafts[presetId] ?? {}, [drafts, presetId]);
  const recommendations = useMemo(
    () => suggestedMappings(presetId, draftCategories),
    [draftCategories, presetId]
  );
  const summary = useMemo(
    () => summarize(draftCategories, mappings, preset.length),
    [draftCategories, mappings, preset.length]
  );
  const serverChanged =
    snapshot != null &&
    (snapshot.ledgerId !== ledgerId || categorySignature(categories) !== snapshot.signature);
  const dirty =
    snapshot != null &&
    (presetId !== snapshot.initialPresetId || !sameMapping(mappings, snapshot.initialMappings));
  const noChanges =
    draftCategories.length === preset.length &&
    draftCategories.every((category, index) => category.name === preset[index]?.name) &&
    summary.unsetCount === 0 &&
    summary.keepCount === 0;
  const canConfirm = !isPreparing && !serverChanged && summary.unsetCount === 0 && !noChanges;

  useEffect(() => {
    const key = `settings:category-preset:${ledgerId}`;
    useUnsavedChangesStore.getState().setDirty(key, open && dirty);
    return () => useUnsavedChangesStore.getState().setDirty(key, false);
  }, [dirty, ledgerId, open]);

  const mutation = useLedgerMutation<ApplyCategoryPresetResult, ApplyCategoryPresetInput>(
    ledgerId,
    {
      invalidates: ["categories", "stats", "documents"],
      refreshMode: "background",
      mutationFn: (input) => applyCategoryPresetAction(ledgerId, input),
      invalidationErrorMessage: tCommon("savedRefreshFailed"),
      onSuccess: (saved) => {
        queryClient.setQueryData(queryKeys.entryCategories(ledgerId), saved.categories);
        setConfirmOpen(false);
        setSaveError(null);
        setResult(saved);
      },
      onError: (error) => {
        setConfirmOpen(false);
        setSaveError(
          errorCode(error) === "CONFLICT" ? t("updateConflict") : t("presetApplyFailed")
        );
      },
    }
  );

  const choosePreset = useCallback(
    (nextPresetId: CategoryPresetId) => {
      if (nextPresetId === presetId) return;
      setDrafts((current) => ({
        ...current,
        [nextPresetId]: current[nextPresetId] ?? suggestedMappings(nextPresetId, draftCategories),
      }));
      setPresetId(nextPresetId);
      setSaveError(null);
    },
    [draftCategories, presetId]
  );

  const initializeSnapshot = useCallback(() => {
    const request = ++revisionRequestRef.current;
    const initialPresetId = matchingPreset(categories) ?? DEFAULT_PRESET_ID;
    const initialMappings = suggestedMappings(initialPresetId, categories);
    setIsPreparing(true);
    setResult(null);
    setSaveError(null);
    void computeCategoryCollectionRevision(categories).then((revision) => {
      if (revisionRequestRef.current !== request) return;
      setSnapshot({
        ledgerId,
        categories: [...categories],
        signature: categorySignature(categories),
        revision,
        initialPresetId,
        initialMappings,
      });
      setPresetId(initialPresetId);
      setDrafts({ [initialPresetId]: initialMappings });
      setIsPreparing(false);
    });
  }, [categories, ledgerId]);

  const openDialog = useCallback(() => {
    setOpen(true);
    initializeSnapshot();
  }, [initializeSnapshot]);

  const forceClose = useCallback(() => {
    revisionRequestRef.current += 1;
    setOpen(false);
    setConfirmOpen(false);
    setDiscardOpen(false);
    setSnapshot(null);
    setDrafts({});
    setResult(null);
    setSaveError(null);
  }, []);
  const closeDialog = useCallback(() => {
    if (dirty && result == null) {
      setDiscardAction("close");
      setDiscardOpen(true);
    } else forceClose();
  }, [dirty, forceClose, result]);
  const reloadCategories = useCallback(() => {
    if (dirty) {
      setDiscardAction("reload");
      setDiscardOpen(true);
      return;
    }
    initializeSnapshot();
  }, [dirty, initializeSnapshot]);
  const confirmDiscard = useCallback(() => {
    setDiscardOpen(false);
    if (discardAction === "reload") initializeSnapshot();
    else forceClose();
    return true;
  }, [discardAction, forceClose, initializeSnapshot]);
  const setMapping = useCallback(
    (fromCategoryId: string, value: number | null | undefined) => {
      setDrafts((current) => ({
        ...current,
        [presetId]: { ...(current[presetId] ?? {}), [fromCategoryId]: value },
      }));
      setSaveError(null);
    },
    [presetId]
  );
  const confirm = useCallback(async () => {
    if (snapshot == null || summary.unsetCount > 0 || serverChanged) return false;
    await mutation.mutateAsync({
      expectedRevision: snapshot.revision,
      presetId,
      mappings: snapshot.categories.map((category) => ({
        fromCategoryId: category.id,
        toPresetIndex: mappings[category.id]!,
      })),
    });
    return true;
  }, [mappings, mutation, presetId, serverChanged, snapshot, summary.unsetCount]);

  return {
    open,
    openDialog,
    closeDialog,
    forceClose,
    confirmOpen,
    setConfirmOpen,
    discardOpen,
    setDiscardOpen,
    presetId,
    preset,
    mappings,
    setMapping,
    isSuggestedMapping: (categoryId: string) =>
      typeof recommendations[categoryId] === "number" &&
      mappings[categoryId] === recommendations[categoryId],
    choosePreset,
    reloadCategories,
    confirmDiscard,
    summary,
    canConfirm,
    noChanges,
    serverChanged,
    isPending: mutation.isPending,
    isPreparing,
    saveError,
    result,
    confirm,
    categories: draftCategories,
  };
}

function sameMapping(left: PresetMappingDraft, right: PresetMappingDraft): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}

export type CategoryPresetSwitch = ReturnType<typeof useCategoryPresetSwitch>;
