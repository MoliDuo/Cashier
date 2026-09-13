"use client";

import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { cn } from "@/lib/utils";

interface BatchCurrencyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The ledger's own currencies, listed first. */
  preferredCurrencies: string[];
  onSelect: (currency: string) => void;
}

/**
 * The one way to set the currency of a selection. A dialog rather than the menu
 * this replaced, so the codes are read in one list instead of a scroller behind
 * a trigger — the date action beside it already opens one.
 *
 * Choosing is the confirmation: the row applies the change and closes, exactly
 * as the menu item did, and the row's own button in the toolbar spins while the
 * write runs.
 */
export function BatchCurrencyDialog({
  open,
  onOpenChange,
  preferredCurrencies,
  onSelect,
}: BatchCurrencyDialogProps) {
  const t = useTranslations("BatchActions");
  const currencyList = [
    ...preferredCurrencies.filter((currency) =>
      SUPPORTED_CURRENCIES.includes(currency as (typeof SUPPORTED_CURRENCIES)[number])
    ),
    ...SUPPORTED_CURRENCIES.filter((currency) => !preferredCurrencies.includes(currency)),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="modal" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("setCurrency")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto subtle-scrollbar">
          {currencyList.map((currency) => (
            <button
              key={currency}
              type="button"
              // The ledger's own currencies lead the list and stay marked, so
              // the codes anyone actually books in are found without reading
              // every one of them.
              className={cn(
                "flex min-h-11 w-full items-center rounded-sm px-2 py-2 text-left text-sm text-text transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none",
                preferredCurrencies.includes(currency) && "font-medium"
              )}
              onClick={() => {
                onSelect(currency);
                onOpenChange(false);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{currency}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
