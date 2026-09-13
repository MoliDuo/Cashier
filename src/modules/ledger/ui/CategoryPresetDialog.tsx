"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
}

export function CategoryPresetDialog({ preset }: CategoryPresetDialogProps) {
  const t = useTranslations("Settings");
  const common = useTranslations("Common");
  const locale = useLocale();
  const { summary, isPending } = preset;

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
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => preset.choosePreset(presetId)}
                    className="flex w-full items-start justify-between gap-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text">
                        {presetLabel(presetId)}
                      </span>
                      <span className={cn("mt-0.5 block", textRoleClassName("bodyMuted"))}>
                        {presetDescription(presetId)}
                      </span>
                    </span>
                    {selected ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    ) : null}
                  </button>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {getCategoryPreset(presetId, locale).map((category) => (
                      <span
                        key={category.name}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm bg-surface2 px-2 py-1",
                          textRoleClassName("micro")
                        )}
                      >
                        <CategoryIcon iconName={category.icon} className="h-4 w-4" />
                        <span className="text-text">{category.name}</span>
                      </span>
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
                <div key={category.id} className="flex items-center gap-3">
                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate text-sm text-text">{category.name}</span>
                    <span className={cn("shrink-0", textRoleClassName("meta"))}>
                      {t("categoryItemCount", { count: category.entryCount ?? 0 })}
                    </span>
                  </div>
                  <Select
                    value={value}
                    disabled={isPending}
                    onValueChange={(next) =>
                      preset.setMapping(category.id, next === KEEP_VALUE ? null : Number(next))
                    }
                  >
                    <SelectTrigger aria-label={category.name} className="w-44 shrink-0">
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
              {common("cancel")}
            </Button>
            <Button
              type="button"
              disabled={!preset.canConfirm || isPending}
              onClick={() => preset.setConfirmOpen(true)}
            >
              {t("presetApply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={preset.confirmOpen}
        onOpenChange={preset.setConfirmOpen}
        title={t("presetConfirmTitle", { preset: presetLabel(preset.presetId) })}
        description={t("presetConfirmDescription", {
          entries: summary.entryCount,
          keep: summary.keepCount,
        })}
        confirmLabel={t("presetApply")}
        onConfirm={preset.confirm}
      />
    </Dialog>
  );
}
