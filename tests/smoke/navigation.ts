import { expect, type Page } from "@playwright/test";

/** Where a spec goes: the four tabs of the navigation bar. */
export type Destination = "账目" | "明细" | "统计" | "设置";

const DESTINATION_URLS: Record<Destination, RegExp> = {
  账目: /\/records/,
  明细: /\/entries/,
  统计: /\/stats/,
  设置: /\/settings/,
};

/**
 * Activates a control by keyboard. The demo runner serves `next dev`, whose
 * error overlay can sit over a phone's bottom bar and swallow a click;
 * focusing the control and pressing Enter is the path a keyboard user takes,
 * and the overlay does not intercept it.
 */
async function press(page: Page, locator: ReturnType<Page["getByRole"]>) {
  await locator.focus();
  await page.keyboard.press("Enter");
}

export function ledgerNavigation(page: Page) {
  return page.getByRole("navigation", { name: "账本导航" });
}

export async function openTab(page: Page, destination: Destination) {
  const tab = ledgerNavigation(page).getByRole("button", { name: destination, exact: true });
  // The tabs stay disabled until the workspace has mounted, and a key pressed
  // on a disabled button does nothing.
  await expect(tab).toBeEnabled();
  if ((await tab.getAttribute("aria-current")) !== "page") await press(page, tab);
  await expect(page).toHaveURL(DESTINATION_URLS[destination]);
  await expect(tab).toHaveAttribute("aria-current", "page");
}

/**
 * A phone folds a list's toolbar (the period and 筛选) into the top bar's
 * summary; this drops it down there. Wider screens keep it on the page. 选择 is
 * not in it: a phone selects from the top bar itself.
 */
export async function showListControls(page: Page) {
  if ((page.viewportSize()?.width ?? Infinity) >= 768) return;
  const summary = page.locator('header [aria-controls="ledger-list-controls"]');
  await expect(summary).toBeVisible();
  if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
  await expect(summary).toHaveAttribute("aria-expanded", "true");
}
