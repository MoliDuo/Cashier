"use client";

import { CircleSlash } from "lucide-react";
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
import {
  isConfirmableBatchCategoryPick,
  MAX_RECLASSIFICATION_CANDIDATES,
  resolveBatchCategoryPick,
} from "./batch-category-pick";

interface BatchSetCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: EntryCategory[];
  selectedCount: number;
  /** Null is the clear row, which excludes every category pick. */
  pickedCategoryIds: readonly string[];
  clearPicked: boolean;
  onTogglePick: (categoryId: string | null, picked: boolean) => void;
  /** The selection changed after the dialog captured it; confirming would file
   * a different set of entries than the one on screen. */
  selectionChanged: boolean;
  isConfirming: boolean;
  onConfirm: () => void;
}

/**
 * The one way to decide the category of a selection, and the reason there is
 * only one: picking a single category is the user's own answer and is applied
 * as such, while picking several is a question the model answers per entry. The
 * two used to be separate buttons in the band, which made the user choose the
 * mechanism before they had chosen the categories.
 *
 * Confirming is a step of its own, unlike the pickers beside it: a pick here is
 * ambiguous until the summary says which of the two things it will do.
 *
 * The clear row is exclusive because "no category" is not a candidate for the
 * model to weigh — an entry it cannot place stays where it is, which is a
 * different outcome from being emptied.
 */
export function BatchSetCategoryDialog({
  open,
  onOpenChange,
  categories,
  selectedCount,
  pickedCategoryIds,
  clearPicked,
  onTogglePick,
  selectionChanged,
  isConfirming,
  onConfirm,
}: BatchSetCategoryDialogProps) {
  const t = useTranslations("BatchActions");
  const pick = resolveBatchCategoryPick({ categoryIds: pickedCategoryIds, clearPicked });
  const confirmable = isConfirmableBatchCategoryPick(pick);
  const pickedName =
    pick.kind === "assign"
      ? (categories.find((category) => category.id === pick.categoryId)?.name ?? "")
      : "";

  const summary = (() => {
    switch (pick.kind) {
      case "clear":
        return t("categoryPickClear", { count: selectedCount });
      case "assign":
        return t("categoryPickAssign", { count: selectedCount, name: pickedName });
      case "ai":
        return t("categoryPickAi", { count: pick.categoryIds.length });
      case "tooMany":
        return t("categoryPickLimit", { count: MAX_RECLASSIFICATION_CANDIDATES });
      case "none":
        return "";
    }
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isConfirming) onOpenChange(next);
      }}
    >
      <DialogContent
        variant="modal"
        aria-describedby={undefined}
        hideCloseButton={isConfirming}
        onEscapeKeyDown={(event) => {
          if (isConfirming) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isConfirming) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("manualCategory")}</DialogTitle>
        </DialogHeader>

        <p className={textRoleClassName("bodyMuted")}>
          {t("categoryPickDescription", { count: selectedCount })}
        </p>

        <div className="max-h-[60vh] overflow-y-auto subtle-scrollbar">
          <label
            className={cn(
              "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm transition-colors",
              clearPicked ? "bg-accent/60 text-text" : "text-muted-foreground hover:bg-accent"
            )}
          >
            <Checkbox
              checked={clearPicked}
              disabled={isConfirming}
              onCheckedChange={(next) => onTogglePick(null, next === true)}
            />
            <CircleSlash aria-hidden="true" className="h-4 w-4 opacity-50" />
            <span className="min-w-0 flex-1 truncate">{t("uncategorized")}</span>
          </label>

          {categories.length > 0 ? <div className="my-1 h-px bg-border" /> : null}

          {categories.map((category) => {
            const checked = pickedCategoryIds.includes(category.id);
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
                  disabled={isConfirming}
                  onCheckedChange={(next) => onTogglePick(category.id, next === true)}
                />
                <CategoryIcon iconName={category.icon} className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">{category.name}</span>
              </label>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:items-center sm:justify-between sm:space-x-0">
          <p className={textRoleClassName("meta")} aria-live="polite">
            {summary}
            {selectionChanged ? `${summary === "" ? "" : " "}${t("selectionMoved")}` : ""}
          </p>
          <Button
            type="button"
            disabled={!confirmable || selectionChanged || isConfirming || selectedCount === 0}
            onClick={onConfirm}
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
