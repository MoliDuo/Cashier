"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { EntryCategory, SaveEntryCategoriesInput } from "@/modules/ledger/contracts";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";
import { clearDraft, draftKey, readDraft, writeDraft } from "@/lib/drafts";
import { useLedgerId } from "./useLedgerId";
import {
  categoryDraftsEqual,
  editDraftEqual,
  toCategoryDraft,
  type CategoryDraft,
  type EditSession,
} from "./category-draft-model";

export type { CategoryDraft, EditSession } from "./category-draft-model";

interface UseCategoryManagementDraftOptions {
  categories: EntryCategory[];
  onSaveCategories: (input: SaveEntryCategoriesInput) => Promise<EntryCategory[]>;
  onReloadCategories?: (() => Promise<EntryCategory[]>) | undefined;
  isSaving: boolean;
}

/** The list being edited, and the list it was edited from. */
interface StoredCategoryDraft {
  base: CategoryDraft[];
  order: CategoryDraft[];
}

function parseCategoryDrafts(value: unknown): CategoryDraft[] | null {
  if (!Array.isArray(value)) return null;
  const drafts: CategoryDraft[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object") return null;
    const { key, id, clientId, name, description, icon } = item as Record<string, unknown>;
    if (
      typeof key !== "string" ||
      typeof name !== "string" ||
      typeof description !== "string" ||
      (icon !== null && typeof icon !== "string") ||
      (id !== undefined && typeof id !== "string") ||
      (clientId !== undefined && typeof clientId !== "string")
    ) {
      return null;
    }
    drafts.push({
      key,
      name,
      description,
      icon: icon as string | null,
      ...(id === undefined ? {} : { id: id as string }),
      ...(clientId === undefined ? {} : { clientId: clientId as string }),
    });
  }
  return drafts;
}

function parseStoredCategoryDraft(data: unknown): StoredCategoryDraft | null {
  if (data == null || typeof data !== "object") return null;
  const base = parseCategoryDrafts((data as Record<string, unknown>).base);
  const order = parseCategoryDrafts((data as Record<string, unknown>).order);
  return base == null || order == null ? null : { base, order };
}

/**
 * The category list's edit session. The list saves as one batch, so its edits
 * are a draft: kept across a reload, restored on return, and asked about only
 * when the reader cancels them. A list that changed elsewhere since the draft
 * began cannot be saved over; the reader reloads it instead.
 */
export function useCategoryManagementDraft({
  categories,
  onSaveCategories,
  onReloadCategories,
  isSaving,
}: UseCategoryManagementDraftOptions) {
  const t = useTranslations("Settings");
  const ledgerId = useLedgerId();
  const key = ledgerId == null ? null : draftKey(ledgerId, "categories", "ledger");
  const [restored] = useState(() =>
    key == null ? null : (readDraft(key, parseStoredCategoryDraft)?.data ?? null)
  );
  const [restoredFromDraft, setRestoredFromDraft] = useState(restored != null);
  const [managing, setManaging] = useState(restored != null);
  const [serverDraft, setServerDraft] = useState<CategoryDraft[]>(restored?.base ?? []);
  const [draftOrder, setDraftOrder] = useState<CategoryDraft[]>(restored?.order ?? []);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CategoryDraft | null>(null);
  const [discardManagementOpen, setDiscardManagementOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const incomingDraft = useMemo(() => categories.map(toCategoryDraft), [categories]);

  const dirty = managing && !categoryDraftsEqual(serverDraft, draftOrder);

  // The single-category edit dialog: its draft against the category it opened on.
  const [editSession, setEditSession] = useState<EditSession | null>(null);
  const [discardEditOpen, setDiscardEditOpen] = useState(false);
  const editDirty = editSession != null && !editDraftEqual(editSession.original, editSession.draft);

  const hasCategoryDraft = dirty || newCategoryName.trim() !== "" || editDirty;
  const serverMoved = managing && !categoryDraftsEqual(serverDraft, incomingDraft);

  // Untouched, the list simply follows the server; touched, it is a conflict.
  if (serverMoved && !hasCategoryDraft) {
    setServerDraft(incomingDraft);
    setDraftOrder(incomingDraft);
  }
  const revisionConflict = managing && (saveConflict || (serverMoved && hasCategoryDraft));

  useEffect(() => {
    if (key == null) return;
    if (dirty) writeDraft(key, { base: serverDraft, order: draftOrder });
    else clearDraft(key);
  }, [dirty, draftOrder, key, serverDraft]);

  const displayedCategories = managing ? draftOrder : incomingDraft;

  const leaveManagement = (next: CategoryDraft[]) => {
    setServerDraft(next);
    setDraftOrder(next);
    setNewCategoryName("");
    setEditSession(null);
    setManaging(false);
    setSaveConflict(false);
    setSaveError(null);
    setRestoredFromDraft(false);
  };

  const enterManagement = () => {
    setServerDraft(incomingDraft);
    setDraftOrder(incomingDraft);
    setManaging(true);
    setSaveConflict(false);
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

  const confirmDiscardManagement = () => leaveManagement(incomingDraft);

  const confirmDeleteCategory = () => {
    if (deleteTarget == null) return;
    setDraftOrder((current) => current.filter((category) => category.key !== deleteTarget.key));
    setSaveError(null);
  };

  const startEditing = (category: CategoryDraft) => {
    const draft = {
      key: category.key,
      name: category.name,
      description: category.description,
      icon: category.icon,
    };
    setEditSession({ original: draft, draft });
  };

  const requestEditClose = () => {
    if (editSession == null) return;
    if (editDirty) setDiscardEditOpen(true);
    else setEditSession(null);
  };

  const commitEdit = () => {
    if (editSession == null) return;
    const updated = editSession.draft;
    setDraftOrder((current) =>
      current.map((category) =>
        category.key === updated.key
          ? {
              ...category,
              name: updated.name.trim(),
              description: updated.description,
              icon: updated.icon,
            }
          : category
      )
    );
    setEditSession(null);
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
      leaveManagement(saved.map(toCategoryDraft));
    } catch (error) {
      const errorCode =
        typeof error === "object" && error != null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (errorCode === "CONFLICT") setSaveConflict(true);
      else setSaveError(t("saveCategoriesFailed"));
    }
  };

  const handleReload = async () => {
    if (onReloadCategories == null) {
      leaveManagement(incomingDraft);
      return;
    }
    try {
      const latest = await onReloadCategories();
      leaveManagement(latest.map(toCategoryDraft));
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
    /** True while the list shows edits restored from an earlier visit. */
    restoredFromDraft: restoredFromDraft && dirty,
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
