import { expect } from "vitest";
import { amountTextClassName, type AmountVariant } from "@/modules/currency/ui/amount-text";
import { textRoleClassName, type TextRole } from "@/components/typography";

/**
 * Anchors a rendered element to one of the app's two class tables instead of to
 * the spellings they currently produce.
 *
 * A test written as `toHaveClass("text-sm", "font-medium")` fails when the role
 * is retuned, although nothing is broken, and passes when a component walks away
 * from the table and hard-codes the same size, which is the regression the table
 * exists to prevent. Asking whether the element carries what the table yields
 * gets both cases the right way round.
 */
function expectTableClasses(element: Element | null, table: string, source: string): void {
  if (element == null) throw new Error(`Expected an element to compare against ${source}`);
  const actual = new Set(element.className.split(/\s+/).filter(Boolean));
  const missing = table.split(" ").filter((token) => !actual.has(token));
  expect({ source, missing }).toEqual({ source, missing: [] });
}

/** Asserts the element is styled by the given text role. */
export function expectTextRole(element: Element | null, role: TextRole): void {
  expectTableClasses(element, textRoleClassName(role), `textRoleClassName("${role}")`);
}

/** Asserts the element is styled by the given amount variant. */
export function expectAmountVariant(element: Element | null, variant: AmountVariant): void {
  expectTableClasses(element, amountTextClassName(variant), `amountTextClassName("${variant}")`);
}
