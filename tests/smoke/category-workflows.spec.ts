import { expect, test } from "@playwright/test";

test("AI category assignment remains visible across tabs and fits narrow screens", async ({
  page,
  isMobile,
}, testInfo) => {
  const isShortMobile = testInfo.project.name === "short-mobile";
  if (isMobile && !isShortMobile) await page.setViewportSize({ width: 390, height: 844 });
  const item = `Category workflow ${testInfo.project.name}`;

  await page.goto("/en/login");
  await page.getByLabel("Email Address", { exact: true }).fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.getByRole("button", { name: "New Record", exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByRole("button", { name: "Quick Entry", exact: true }).click();
  await create.getByRole("textbox", { name: "Item name (optional)", exact: true }).fill(item);
  await create.getByRole("group").getByRole("button").first().click();
  await create.getByRole("textbox", { name: "Amount", exact: true }).fill("12.34");
  await create.getByRole("button", { name: "Record", exact: true }).click();

  const navigation = page.getByRole("navigation", { name: "Ledger navigation" });
  await navigation.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByText(item, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: `Select ${item}`, exact: true }).click();
  await page.getByRole("button", { name: /^(Set Category|Category)$/ }).click();

  const categoryDialog = page.getByRole("dialog");
  await expect(categoryDialog.getByRole("heading", { name: "Set Category" })).toBeVisible();
  const candidates = categoryDialog.getByRole("checkbox");
  await candidates.nth(1).click();
  await candidates.nth(2).click();
  const confirm = categoryDialog.getByRole("button", { name: "AI categorize 1 entries" });

  if (isShortMobile) {
    await page.locator("html").evaluate((element) => {
      element.style.fontSize = "125%";
    });
    await expect(confirm).toBeVisible();
    const box = await confirm.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(568);
  }

  await confirm.click();
  await expect(categoryDialog).toHaveCount(0);
  const status = page.locator("#category-assignment-status");
  await expect(status).toBeVisible();

  await navigation.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(status).toBeVisible();
  await navigation.getByRole("button", { name: "Details", exact: true }).click();
  await expect(status).toBeVisible();
  await expect(status).toContainText(/Updated 1; 0 already matched/, { timeout: 20_000 });

  await status.getByRole("button", { name: "View results", exact: true }).click();
  const results = page.getByRole("dialog");
  await expect(results.getByText(item, { exact: true })).toBeVisible();
  await expect(results.getByText("Updated", { exact: true })).toBeVisible();
  await results.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(results).toHaveCount(0);

  // A finished run reports itself until the reader closes it, and then stays closed.
  await status.getByRole("button", { name: "Close", exact: true }).click();
  await expect(status).toHaveCount(0);
  await navigation.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(status).toHaveCount(0);
  await navigation.getByRole("button", { name: "Details", exact: true }).click();
  await expect(status).toHaveCount(0);
});
