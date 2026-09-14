"use client";

import { useTranslations } from "next-intl";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { textRoleClassName } from "@/components/typography";
import { getCategoryPreset, type CategoryPresetId } from "@/config/category-presets";
import type { CategoryPresetSwitch } from "@/modules/ledger/hooks/useCategoryPresetSwitch";
import { cn } from "@/lib/utils";

const PRESET_ORDER: readonly CategoryPresetId[] = ["default", "concise"];
/** Radix Select needs a non-empty value; `""` also makes it show the placeholder. */
const KEEP_VALUE = "keep";
const UNSET_VALUE = "";

interface CategoryPresetDialogProps {
  preset: CategoryPresetSwitch;
  onGoToDetails?: (validCategoryIds: readonly string[]) => void;
}

export function CategoryPresetDialog({ preset, onGoToDetails }: CategoryPresetDialogProps) {
  const t = useTranslations("Settings");
  const common = useTranslations("Common");
  const { summary } = preset;
  const isPending = preset.isPending || preset.isPreparing;

  // Literal keys only: the i18n validator rejects `t()` fed a lookup result.
  const presetLabel = (id: CategoryPresetId) =>
    id === "default" ? t("presetOptionDefault") : t("presetOptionConcise");
  const presetDescription = (id: CategoryPresetId) =>
    id === "default" ? t("presetOptionDefaultDesc") : t("presetOptionConciseDesc");

  const summaryLines = [
    t("presetSummary", { count: summary.directCount, entries: summary.entryCount }),
  ];
  if (summary.unsetCount > 0) {
    summaryLines.push(t("presetSummaryUnset", { count: summary.unsetCount }));
  }
  if (summary.directCount === 0) summaryLines.push(t("presetSummaryNone"));

  return (
    <Dialog
      open={preset.open}
      onOpenChange={(next) => {
        if (!next && !isPending) preset.closeDialog();
      }}
    >
      <DialogContent
        variant="detail"
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100vw-2rem)] sm:max-w-2xl sm:rounded-lg"
        aria-describedby={undefined}
        hideCloseButton={isPending}
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <DialogTitle>{t("presetDialogTitle")}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          <div role="radiogroup" aria-label={t("presetDialogTitle")} className="space-y-3">
            {PRESET_ORDER.map((presetId) => {
              const selected = preset.presetId === presetId;
              return (
                <div
                  key={presetId}
                  className={cn(
                    "rounded-lg border p-3",
                    selected ? "border-primary" : "border-border"
                  )}
                >
                  <label className="flex min-h-11 w-full cursor-pointer items-start gap-3 text-left">
                    <input
                      type="radio"
                      name="category-preset"
                      checked={selected}
                      disabled={isPending}
                      onChange={() => preset.choosePreset(presetId)}
                      className="mt-1 size-4 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text">
                        {presetLabel(presetId)}
                      </span>
                      <span className={cn("mt-0.5 block", textRoleClassName("bodyMuted"))}>
                        {presetDescription(presetId)}
                      </span>
                    </span>
                  </label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {getCategoryPreset(presetId, preset.locale).map((category) => (
                      <details
                        key={category.name}
                        className={cn(
                          "rounded-sm bg-surface2 px-2 py-1",
                          textRoleClassName("micro")
                        )}
                      >
                        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-text">
                          <CategoryIcon iconName={category.icon} className="h-4 w-4" />
                          {category.name}
                        </summary>
                        <p className="mt-1 max-w-xs text-muted-foreground">
                          {category.description}
                        </p>
                      </details>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <h4 className={textRoleClassName("cardTitle")}>{t("presetMappingTitle")}</h4>
            {preset.categories.map((category) => {
              const mapping = preset.mappings[category.id];
              const value =
                mapping === undefined
                  ? UNSET_VALUE
                  : mapping === null
                    ? KEEP_VALUE
                    : String(mapping);
              return (
                <div
                  key={category.id}
                  className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 truncate text-sm text-text">{category.name}</span>
                      {preset.isSuggestedMapping(category.id) ? (
                        <span className={textRoleClassName("micro")}>{t("presetSuggested")}</span>
                      ) : null}
                    </div>
                    <span className={cn("shrink-0", textRoleClassName("meta"))}>
                      {t("categoryItemCount", { count: category.entryCount ?? 0 })}
                    </span>
                    {category.description == null || category.description === "" ? null : (
                      <details className={textRoleClassName("meta")}>
                        <summary className="flex min-h-11 cursor-pointer items-center">
                          {t("presetExpandDescription")}
                        </summary>
                        <p className="text-muted-foreground">{category.description}</p>
                      </details>
                    )}
                  </div>
                  <Select
                    value={value}
                    disabled={isPending}
                    onValueChange={(next) =>
                      preset.setMapping(category.id, next === KEEP_VALUE ? null : Number(next))
                    }
                  >
                    <SelectTrigger aria-label={category.name} className="w-full shrink-0 sm:w-44">
                      <SelectValue placeholder={t("presetMappingUnset")} />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value={KEEP_VALUE}>{t("presetMappingKeep")}</SelectItem>
                      {preset.preset.map((target, index) => (
                        <SelectItem key={target.name} value={String(index)}>
                          <span className="inline-flex items-center gap-2">
                            <CategoryIcon iconName={target.icon} className="h-4 w-4" />
                            {target.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
          <div className="space-y-2">
            <h4 className={textRoleClassName("cardTitle")}>{t("presetFinalStructure")}</h4>
            <p className={textRoleClassName("bodyMuted")}>{t("presetWholeCategoryDescription")}</p>
            <p className={textRoleClassName("bodyMuted")}>{t("presetUncategorizedDescription")}</p>
            <p className={textRoleClassName("bodyMuted")}>{t("presetAfterDescription")}</p>
            <p className={textRoleClassName("bodyMuted")}>{t("presetMergeIrreversible")}</p>
            <p className={textRoleClassName("bodyStrong")}>
              {[
                ...preset.preset.map((category) => category.name),
                ...preset.categories
                  .filter((category) => preset.mappings[category.id] === null)
                  .map((category) => category.name),
              ].join(" · ")}
            </p>
            <p className={textRoleClassName("meta")}>
              {t("presetImpactPreview", {
                entries: summary.entryCount,
                merged: summary.mergedCount,
                created: summary.createdCount,
                retained: summary.keepCount,
              })}
            </p>
          </div>
          {preset.serverChanged ? (
            <div className="flex flex-wrap items-center gap-2 border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <p className="min-w-0 flex-1" role="alert">
                {t("presetDraftChanged")}
              </p>
              <Button type="button" size="sm" variant="outline" onClick={preset.reloadCategories}>
                {t("presetReloadCategories")}
              </Button>
            </div>
          ) : null}
          {preset.result == null ? null : (
            <div
              className="border border-success/30 bg-success/10 p-3 text-sm text-success"
              role="status"
            >
              {t("presetResultSummary", {
                entries: preset.result.movedEntryCount,
                created: preset.result.createdCategoryCount,
                removed: preset.result.removedCategoryCount,
                retained: preset.result.retainedCategoryCount,
              })}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-3 border-t px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0 sm:px-6 sm:py-4">
          <div className="space-y-0.5 text-left" aria-live="polite">
            {summaryLines.map((line) => (
              <p key={line} className={textRoleClassName("meta")}>
                {line}
              </p>
            ))}
            {preset.saveError == null ? null : (
              <p className="text-sm text-destructive" role="alert">
                {preset.saveError}
              </p>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={preset.closeDialog}
            >
              {preset.result == null ? common("cancel") : common("close")}
            </Button>
            {preset.result == null ? (
              <Button
                type="button"
                disabled={!preset.canConfirm || isPending}
                onClick={() => preset.setConfirmOpen(true)}
              >
                {preset.noChanges
                  ? t("presetNoChanges")
                  : isPending
                    ? t("presetApplying")
                    : t("presetApply")}
              </Button>
            ) : onGoToDetails == null ? null : (
              <Button
                type="button"
                onClick={() =>
                  onGoToDetails(preset.result!.categories.map((category) => category.id))
                }
              >
                {t("presetGoToDetails")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={preset.confirmOpen}
        onOpenChange={preset.setConfirmOpen}
        title={t("presetConfirmTitle", { preset: presetLabel(preset.presetId) })}
        description={t("presetConfirmDescription", {
          entries: summary.entryCount,
          merged: summary.mergedCount,
          created: summary.createdCount,
          retained: summary.keepCount,
        })}
        confirmLabel={t("presetApply")}
        onConfirm={preset.confirm}
      />
      <ConfirmDialog
        open={preset.discardOpen}
        onOpenChange={preset.setDiscardOpen}
        title={common("unsavedChangesTitle")}
        description={common("unsavedChangesDescription")}
        confirmLabel={common("discard")}
        variant="destructive"
        onConfirm={preset.confirmDiscard}
      />
    </Dialog>
  );
}
