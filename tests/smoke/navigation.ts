import { expect, type Page } from "@playwright/test";

/**
 * Where a spec goes. 流水 and 明细 are 账目 by bill and by entry; 设置 is the
 * top bar's gear, not a tab.
 */
export type Destination = "流水" | "明细" | "统计" | "设置";

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
  if (destination === "设置") {
    if (!/\/settings(\?|$)/.test(page.url())) {
      await press(page, page.getByRole("link", { name: "设置", exact: true }));
    }
    await expect(page).toHaveURL(/\/settings/);
    return;
  }
  const navigation = ledgerNavigation(page);
  if (destination === "统计") {
    await press(page, navigation.getByRole("button", { name: "统计", exact: true }));
    await expect(page).toHaveURL(/\/stats/);
    return;
  }
  const records = navigation.getByRole("button", { name: "账目", exact: true });
  if ((await records.getAttribute("aria-current")) !== "page") await press(page, records);
  await expect(page).toHaveURL(/\/records/);
  const view = page
    .getByRole("group", { name: "账目视图" })
    .getByRole("button", { name: destination === "明细" ? "按明细" : "按账单", exact: true });
  if ((await view.getAttribute("aria-pressed")) !== "true") await view.click();
  await expect(view).toHaveAttribute("aria-pressed", "true");
}
