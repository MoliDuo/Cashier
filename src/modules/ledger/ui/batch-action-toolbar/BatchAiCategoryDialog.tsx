"use client";

import { useTranslations } from "next-intl";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import type { EntryCategory } from "@/modules/ledger/contracts";

/** Fewer than two candidates gives the model nothing to choose between; more
 * than eight dilutes the decision and the prompt. */
export const MIN_RECLASSIFICATION_CANDIDATES = 2;
export const MAX_RECLASSIFICATION_CANDIDATES = 8;

interface BatchAiCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: EntryCategory[];
  selectedCount: number;
  selectedCategoryIds: readonly string[];
  onToggleCategory: (categoryId: string, selected: boolean) => void;
  /** The selection changed after the dialog captured it; confirming would file
   * a different set of entries than the one on screen. */
  selectionChanged: boolean;
  isStarting: boolean;
  onStart: () => void;
}

/**
 * Pick the candidates the model may assign entries to. Unlike the manual
 * category picker, choosing here does not apply anything: it narrows the
 * question, and the run answers it in the background.
 *
 * There is deliberately no "uncategorize" row — an entry the model cannot
 * place stays where it is, which is a different outcome from clearing it.
 */
export function BatchAiCategoryDialog({
  open,
  onOpenChange,
  categories,
  selectedCount,
  selectedCategoryIds,
  onToggleCategory,
  selectionChanged,
  isStarting,
  onStart,
}: BatchAiCategoryDialogProps) {
  const t = useTranslations("BatchActions");
  const chosen = selectedCategoryIds.length;
  const withinRange =
    chosen >= MIN_RECLASSIFICATION_CANDIDATES && chosen <= MAX_RECLASSIFICATION_CANDIDATES;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isStarting) onOpenChange(next);
      }}
    >
      <DialogContent
        variant="modal"
        aria-describedby={undefined}
        hideCloseButton={isStarting}
        onEscapeKeyDown={(event) => {
          if (isStarting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isStarting) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("aiCategoryTitle")}</DialogTitle>
        </DialogHeader>

        <p className={textRoleClassName("bodyMuted")}>
          {t("aiCategoryDescription", { count: selectedCount })}
        </p>

        <div className="max-h-[60vh] overflow-y-auto subtle-scrollbar">
          {categories.map((category) => {
            const checked = selectedCategoryIds.includes(category.id);
            return (
              <label
                key={category.id}
                className={cn(
                  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm text-text transition-colors",
                  checked ? "bg-accent/60" : "hover:bg-accent"
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={isStarting}
                  onCheckedChange={(next) => onToggleCategory(category.id, next === true)}
                />
                <CategoryIcon iconName={category.icon} className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">{category.name}</span>
              </label>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:items-center sm:justify-between sm:space-x-0">
          <p className={textRoleClassName("meta")} aria-live="polite">
            {withinRange
              ? t("aiCategoryCandidates", { count: chosen })
              : chosen < MIN_RECLASSIFICATION_CANDIDATES
                ? t("aiCategoryNeedCandidates", { count: MIN_RECLASSIFICATION_CANDIDATES })
                : t("aiCategoryCandidateLimit", { count: MAX_RECLASSIFICATION_CANDIDATES })}
            {selectionChanged ? ` ${t("selectionMoved")}` : ""}
          </p>
          <Button
            type="button"
            disabled={!withinRange || selectionChanged || isStarting || selectedCount === 0}
            onClick={onStart}
          >
            {t("aiCategoryStart")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
