import { cn } from "@/lib/utils";

export type AmountVariant = "hero" | "summary" | "subtotal" | "item" | "secondary" | "caption";

const amountVariantClasses: Record<AmountVariant, string> = {
  hero: "text-3xl font-semibold text-text sm:text-4xl",
  summary: "text-base font-semibold text-text",
  // The total that heads a group of entries. It is a sum of the amounts below
  // it, so it keeps their weight and colour at one size down: quieter than a
  // card's own total, never the muted grey of a hint.
  subtotal: "text-sm font-semibold text-text",
  item: "text-base font-semibold text-text",
  secondary: "text-xs font-normal text-muted-foreground",
  // A muted caption that happens to hold an amount, not a value to scan by.
  caption: "text-xs font-medium text-muted-foreground",
};

export function amountTextClassName(variant: AmountVariant, className?: string) {
  // Amounts share the app's system sans stack rather than a monospace face;
  // tabular-nums keeps the digits column-aligned without the width jitter.
  return cn("tabular-nums", amountVariantClasses[variant], className);
}

export function AmountText({
  children,
  variant,
  className,
}: {
  children: React.ReactNode;
  variant: AmountVariant;
  className?: string;
}) {
  return <span className={amountTextClassName(variant, className)}>{children}</span>;
}
