"use client";

import { useEffect, useState } from "react";
import type { useTranslations } from "next-intl";
import type { EntryCategory, SaveEntryCategoriesInput } from "@/modules/ledger/contracts";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";
import { categoryDraftsEqual, toCategoryDraft, type CategoryDraft } from "./category-draft-model";
import { useCategoryEditSession } from "./useCategoryEditSession";
import { useCategoryDraftSync } from "./useCategoryDraftSync";

export type { CategoryDraft, EditSession } from "./category-draft-model";

interface UseCategoryManagementDraftOptions {
  categories: EntryCategory[];
  onSaveCategories: (input: SaveEntryCategoriesInput) => Promise<EntryCategory[]>;
  onReloadCategories?: (() => Promise<EntryCategory[]>) | undefined;
  isSaving: boolean;
  t: ReturnType<typeof useTranslations>;
}

/** Owns the category list's draft/server-sync state machine and save/reload flow. */
export function useCategoryManagementDraft({
  categories,
  onSaveCategories,
  onReloadCategories,
  isSaving,
  t,
}: UseCategoryManagementDraftOptions) {
  const [managing, setManaging] = useState(false);
  const [serverDraft, setServerDraft] = useState<CategoryDraft[]>([]);
  const [draftOrder, setDraftOrder] = useState<CategoryDraft[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CategoryDraft | null>(null);
  const [discardManagementOpen, setDiscardManagementOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = managing && !categoryDraftsEqual(serverDraft, draftOrder);

  const {
    editSession,
    setEditSession,
    discardEditOpen,
    setDiscardEditOpen,
    editDirty,
    requestEditClose,
    startEditing,
    commitEdit,
  } = useCategoryEditSession({ setDraftOrder, setSaveError });

  const hasCategoryDraft = dirty || newCategoryName.trim() !== "" || editDirty;

  const { incomingDraft, revisionConflict, setRevisionConflict, resetSyncState } =
    useCategoryDraftSync({
      categories,
      managing,
      serverDraft,
      setServerDraft,
      setDraftOrder,
      hasCategoryDraft,
    });

  useEffect(() => {
    const key = "settings:categories";
    useUnsavedChangesStore.getState().setDirty(key, hasCategoryDraft);
    return () => useUnsavedChangesStore.getState().setDirty(key, false);
  }, [hasCategoryDraft]);

  const displayedCategories = managing ? draftOrder : incomingDraft;

  const enterManagement = () => {
    setServerDraft(incomingDraft);
    setDraftOrder(incomingDraft);
    setManaging(true);
    resetSyncState();
    setSaveError(null);
  };

  const move = (index: number, direction: -1 | 1) => {
    setDraftOrder((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item == null) return current;
      next.splice(target, 0, item);
      return next;
    });
    setSaveError(null);
  };

  const createCategory = () => {
    const name = newCategoryName.trim();
    if (name === "" || isSaving) return;
    const clientId = crypto.randomUUID();
    setDraftOrder((current) => [
      ...current,
      {
        key: clientId,
        clientId,
        name,
        description: "",
        icon: null,
      },
    ]);
    setNewCategoryName("");
    setSaveError(null);
  };

  const cancelManagement = () => {
    if (hasCategoryDraft) setDiscardManagementOpen(true);
    else setManaging(false);
  };

  const confirmDiscardManagement = () => {
    setDraftOrder(serverDraft);
    setNewCategoryName("");
    setEditSession(null);
    setManaging(false);
    resetSyncState();
    setSaveError(null);
  };

  const confirmDeleteCategory = () => {
    if (deleteTarget == null) return;
    setDraftOrder((current) => current.filter((category) => category.key !== deleteTarget.key));
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!dirty || isSaving || revisionConflict) return;
    setSaveError(null);
    try {
      const expectedRevision = await computeCategoryCollectionRevision(categories);
      const saved = await onSaveCategories({
        expectedRevision,
        categories: draftOrder.map((category) => ({
          ...(category.id === undefined ? {} : { id: category.id }),
          ...(category.clientId === undefined ? {} : { clientId: category.clientId }),
          name: category.name.trim(),
          description: category.description.trim() || null,
          icon: category.icon,
        })),
      });
      const savedDraft = saved.map(toCategoryDraft);
      setServerDraft(savedDraft);
      setDraftOrder(savedDraft);
      setManaging(false);
      resetSyncState();
    } catch (error) {
      const errorCode =
        typeof error === "object" && error != null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (errorCode === "CONFLICT") {
        setRevisionConflict(true);
        setSaveError(t("updateConflict"));
      } else {
        setSaveError(t("saveCategoriesFailed"));
      }
    }
  };

  const handleReload = async () => {
    if (onReloadCategories == null) return;
    try {
      const latest = await onReloadCategories();
      const latestDraft = latest.map(toCategoryDraft);
      setServerDraft(latestDraft);
      setDraftOrder(latestDraft);
      setNewCategoryName("");
      setEditSession(null);
      setManaging(false);
      resetSyncState();
      setSaveError(null);
    } catch {
      setSaveError(t("saveCategoriesFailed"));
    }
  };

  return {
    managing,
    newCategoryName,
    setNewCategoryName,
    editSession,
    setEditSession,
    deleteTarget,
    setDeleteTarget,
    discardManagementOpen,
    setDiscardManagementOpen,
    discardEditOpen,
    setDiscardEditOpen,
    revisionConflict,
    saveError,
    dirty,
    displayedCategories,
    enterManagement,
    move,
    createCategory,
    requestEditClose,
    handleSave,
    handleReload,
    startEditing,
    commitEdit,
    cancelManagement,
    confirmDiscardManagement,
    confirmDeleteCategory,
  };
}
