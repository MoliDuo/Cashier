import { expect, test } from "@playwright/test";
import { selectBook } from "./book-switch";

test("@demo opens a populated workspace with evidence and statistics", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/en");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "Continue as dev", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // This walkthrough runs the dev server, where Next's issues pill sits in a
  // viewport corner — over the source-document modal's own footer controls at
  // phone widths. Collapsing it is what a developer does when it gets in the
  // way; the badge is absent in a production build, so the click is optional.
  const issuesBadge = page.getByRole("button", { name: "Collapse issues badge" });
  if ((await issuesBadge.count()) > 0) await issuesBadge.click();

  const coffee = page.getByTestId("source-document-card-root").filter({ hasText: "Harbor Coffee" });
  await expect(coffee).toBeVisible();
  await coffee.getByRole("button", { name: /Harbor Coffee/ }).click();
  const detail = page.getByRole("dialog").first();
  await expect(detail.getByText("Flat White", { exact: true })).toBeVisible();
  await expect(detail.getByText("Chicken Sandwich", { exact: true })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await detail.getByRole("button", { name: "Evidence", exact: true }).click();
  }
  await expect(detail.getByRole("img", { name: "Image 1" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await detail.getByRole("button", { name: "Back to details", exact: true }).click();
  }
  await detail.getByRole("button", { name: "Close", exact: true }).click();

  // The strip runs 总账 / 共同支出 / 哞哞 / 梁梁; FreshMart is in 梁梁 and
  // Harbor Coffee in 哞哞.
  await selectBook(page, 2);
  await expect(page.getByText("FreshMart", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Harbor Coffee", { exact: true })).toHaveCount(0);
  await selectBook(page, 1);
  await expect(page.getByText("Harbor Coffee", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("FreshMart", { exact: true })).toHaveCount(0);
  await selectBook(page, "all");

  await expect(page.getByText("Regional Rail and Cafe", { exact: true })).toBeVisible();
  await expect(page.getByText("Blurry Parking Receipt", { exact: true })).toBeVisible();
  await expect(page.getByText("Missing Currency Receipt", { exact: true })).toBeVisible();

  // A document the AI could not turn into expenses shows one status plus the
  // reason the AI wrote for the ledger owner, not a generic diagnostic code.
  const blurry = page
    .getByTestId("source-document-card-root")
    .filter({ hasText: "Blurry Parking Receipt" });
  await expect(blurry.getByTestId("status-label")).toHaveText("Couldn't Parse");
  await blurry.getByRole("button", { name: /Blurry Parking Receipt/ }).click();
  const blurryDetail = page.getByRole("dialog").first();
  await expect(blurryDetail.getByText("Couldn't Parse", { exact: true })).toBeVisible();
  await expect(
    blurryDetail.getByText("The receipt photo is too blurry to read the merchant and the total.", {
      exact: true,
    })
  ).toBeVisible();
  await blurryDetail.getByRole("button", { name: "Close", exact: true }).click();

  await page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name: "Stats", exact: true })
    .click();
  await expect(page.getByText("Dining", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Household", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
