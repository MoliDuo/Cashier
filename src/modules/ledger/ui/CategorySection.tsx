"use client";

import { ArrowDown, ArrowUp, CircleSlash, Pencil, RefreshCw, Trash2 } from "lucide-react";
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
import { SettingsSection } from "./settings/SettingsSection";
import { toast } from "sonner";
import { useCategoryAssignment } from "./category-assignment-context";

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
  const { isActive: categoryAssignmentActive } = useCategoryAssignment();

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
    <SettingsSection
      title={t("categories")}
      actions={
        managing ? null : (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isSaving || preset.isPending || categoryAssignmentActive}
              onClick={preset.openDialog}
            >
              {t("switchPreset")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={categoryAssignmentActive}
              onClick={enterManagement}
            >
              {t("manageCategories")}
            </Button>
          </div>
        )
      }
    >
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
                  size="icon-sm"
                  disabled={index === 0 || isSaving}
                  onClick={() => move(index, -1)}
                  aria-label={t("moveCategoryUp", { name: category.name })}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === displayedCategories.length - 1 || isSaving}
                  onClick={() => move(index, 1)}
                  aria-label={t("moveCategoryDown", { name: category.name })}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isSaving}
                  onClick={() => startEditing(category)}
                  aria-label={t("editCategory", { name: category.name })}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-danger"
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
        {/* 未分类 is not a category: it is the absence of one, and it is the same
            state 流水 and 明细 already draw with a slashed circle. So it holds the
            last slot with nothing to press — no rename, no reorder, no delete —
            and only the count says what currently sits in it. */}
        <div
          className="flex min-h-14 items-center gap-3 rounded-md bg-surface2 p-3"
          data-testid="uncategorized-row"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center">
            <CircleSlash aria-hidden="true" className="h-5 w-5 opacity-60" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{t("uncategorized")}</span>
              {uncategorizedCount > 0 ? (
                <span className="text-micro text-warning/80">
                  {t("categoryItemCount", { count: uncategorizedCount })}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {managing ? (
        <div className="space-y-3">
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
              size="sm"
              onClick={createCategory}
              disabled={newCategoryName.trim() === "" || isSaving}
            >
              {t("addCategory")}
            </Button>
          </div>
          {saveError == null ? null : (
            <p role="alert" aria-live="polite" className="text-sm text-destructive">
              {saveError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSaving}
              onClick={cancelManagement}
            >
              {common("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || isSaving}
              onClick={() => {
                if (revisionConflict) toast.error(t("updateConflict"));
                else void handleSave();
              }}
            >
              {isSaving ? t("saving") : common("save")}
            </Button>
          </div>
        </div>
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
    </SettingsSection>
  );
}
