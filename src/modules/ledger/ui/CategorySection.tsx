"use client";

import { ArrowDown, ArrowUp, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type {
  EntryCategory,
  EntryCategoryWithCount,
  SaveEntryCategoriesInput,
} from "@/modules/ledger/contracts";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useCategoryManagementDraft } from "@/modules/ledger/hooks/useCategoryManagementDraft";
import { useCategoryPresetSwitch } from "@/modules/ledger/hooks/useCategoryPresetSwitch";
import { CategoryEditDialog } from "./CategoryEditDialog";
import { CategoryPresetDialog } from "./CategoryPresetDialog";
import { toast } from "sonner";
import { useCategoryAssignmentJob } from "@/modules/ledger/hooks/useCategoryAssignmentJob";
import { isCategoryAssignmentJobActive } from "@/modules/ledger/ui/category-assignment-status-visibility";

interface CategorySectionProps {
  ledgerId: string;
  /** Carries `entryCount`; the preset dialog sums it for its impact summary. */
  categories: EntryCategoryWithCount[];
  uncategorizedCount?: number;
  onSaveCategories: (input: SaveEntryCategoriesInput) => Promise<EntryCategory[]>;
  onReloadCategories?: () => Promise<EntryCategory[]>;
  generatingCategoryIds?: Set<string>;
  failedCategoryIds?: Set<string>;
  onRetryMetadata?: (id: string) => void;
  isSaving?: boolean;
  onGoToDetails?: (validCategoryIds: readonly string[]) => void;
}

export function CategorySection({
  ledgerId,
  categories,
  uncategorizedCount = 0,
  onSaveCategories,
  onReloadCategories,
  generatingCategoryIds = new Set(),
  failedCategoryIds = new Set(),
  onRetryMetadata,
  isSaving = false,
  onGoToDetails,
}: CategorySectionProps) {
  const t = useTranslations("Settings");
  const common = useTranslations("Common");
  const locale = useLocale();
  const preset = useCategoryPresetSwitch({ ledgerId, categories, locale });
  const assignment = useCategoryAssignmentJob(ledgerId);
  const categoryAssignmentActive = isCategoryAssignmentJobActive(assignment.job);

  const {
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
    serverChanged,
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
  } = useCategoryManagementDraft({ categories, onSaveCategories, onReloadCategories, isSaving, t });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-text">{t("categories")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("categoriesDesc")}</p>
        </div>
        {!managing ? (
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSaving || preset.isPending || categoryAssignmentActive}
              onClick={preset.openDialog}
            >
              {t("switchPreset")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={categoryAssignmentActive}
              onClick={enterManagement}
            >
              {t("manageCategories")}
            </Button>
          </div>
        ) : null}
      </div>

      {categoryAssignmentActive ? (
        <div
          className="border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
          role="status"
        >
          <p>{t("categoryAssignmentActive")}</p>
          <Button asChild size="sm" variant="outline" className="mt-2">
            <a href="#category-assignment-status">{t("categoryAssignmentViewTask")}</a>
          </Button>
        </div>
      ) : null}

      {uncategorizedCount > 0 ? (
        <div className="flex items-start gap-3 rounded-md border border-warning/25 bg-warning/10 p-3">
          <span className="mt-1 size-2 shrink-0 rounded-full bg-warning" aria-hidden />
          <div>
            <div className="text-sm font-medium text-warning">{t("uncategorized")}</div>
            <div className="text-xs text-warning/80">
              {t("uncategorizedDesc", { count: uncategorizedCount })}
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {displayedCategories.map((category, index) => (
          <div
            key={category.key}
            className="flex min-h-14 items-center gap-3 rounded-md bg-surface2 p-3"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              <CategoryIcon iconName={category.icon} className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{category.name}</span>
                {category.entryCount == null ? null : (
                  <span className="text-micro text-muted-foreground">
                    {t("categoryItemCount", { count: category.entryCount })}
                  </span>
                )}
                {category.id != null && generatingCategoryIds.has(category.id) ? (
                  <span className="text-micro text-muted-foreground">
                    {t("generatingMetadata")}
                  </span>
                ) : null}
                {category.id != null &&
                failedCategoryIds.has(category.id) &&
                onRetryMetadata != null ? (
                  <Button
                    type="button"
                    onClick={() => onRetryMetadata(category.id!)}
                    variant="ghost"
                    size="sm"
                    className="min-h-11 px-2 text-micro text-danger"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {t("retryMetadata")}
                  </Button>
                ) : null}
              </div>
              {category.description !== "" ? (
                <p className="truncate text-xs text-muted-foreground">{category.description}</p>
              ) : null}
            </div>
            {managing ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  disabled={index === 0 || isSaving}
                  onClick={() => move(index, -1)}
                  aria-label={t("moveCategoryUp", { name: category.name })}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  disabled={index === displayedCategories.length - 1 || isSaving}
                  onClick={() => move(index, 1)}
                  aria-label={t("moveCategoryDown", { name: category.name })}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  disabled={isSaving}
                  onClick={() => startEditing(category)}
                  aria-label={t("editCategory", { name: category.name })}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 text-danger"
                  disabled={isSaving}
                  onClick={() => setDeleteTarget(category)}
                  aria-label={t("deleteCategory", { name: category.name })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {managing ? (
        <>
          <div className="flex gap-2">
            <Input
              value={newCategoryName}
              name="newCategoryName"
              autoComplete="off"
              onChange={(event) => setNewCategoryName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  createCategory();
                }
              }}
              disabled={isSaving}
              aria-label={t("newCategoryPlaceholder")}
              placeholder={t("newCategoryPlaceholder")}
            />
            <Button
              type="button"
              onClick={createCategory}
              disabled={newCategoryName.trim() === "" || isSaving}
            >
              {t("addCategory")}
            </Button>
          </div>
          <div aria-live="polite" className="text-sm">
            {saveError == null ? null : <p className="text-destructive">{saveError}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={isSaving} onClick={cancelManagement}>
              {common("cancel")}
            </Button>
            <Button
              type="button"
              disabled={!dirty || isSaving}
              onClick={() => {
                if (revisionConflict || serverChanged) toast.error(t("updateConflict"));
                else void handleSave();
              }}
            >
              {isSaving ? t("saving") : common("save")}
            </Button>
          </div>
        </>
      ) : null}

      <CategoryEditDialog
        editSession={editSession}
        setEditSession={setEditSession}
        onRequestClose={requestEditClose}
        onCommit={commitEdit}
      />

      <CategoryPresetDialog preset={preset} {...(onGoToDetails == null ? {} : { onGoToDetails })} />

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteCategoryDialog")}
        description={t("deleteCategoryDescription", { name: deleteTarget?.name ?? "" })}
        variant="destructive"
        onConfirm={confirmDeleteCategory}
      />

      <ConfirmDialog
        open={discardManagementOpen}
        onOpenChange={setDiscardManagementOpen}
        title={t("discardCategoryChangesTitle")}
        description={t("discardCategoryChangesDescription")}
        variant="destructive"
        confirmLabel={common("discard")}
        onConfirm={async () => {
          confirmDiscardManagement();
          await handleReload();
        }}
      />

      <ConfirmDialog
        open={discardEditOpen}
        onOpenChange={setDiscardEditOpen}
        title={t("discardCategoryEditTitle")}
        description={t("discardCategoryEditDescription")}
        variant="destructive"
        confirmLabel={common("discard")}
        onConfirm={() => setEditSession(null)}
      />
    </div>
  );
}
