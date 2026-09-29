import { expect, test } from "@playwright/test";
import { showListControls } from "./navigation";
import { signIn } from "./sign-in";

test("the four tabs are routes of their own, and Back walks them", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  await expect(page).toHaveURL(/\/records$/);

  const navigation = page.getByRole("navigation", { name: "账本导航" });
  const destination = (name: string) => navigation.getByRole("button", { name, exact: true });
  await expect(destination("账目")).toBeEnabled();

  await destination("明细").click();
  await expect(page).toHaveURL(/\/entries$/);
  await destination("统计").click();
  await expect(page).toHaveURL(/\/stats$/);
  await destination("设置").click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/stats$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/entries$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/records$/);

  await page.goto("/stream");
  await expect(page).toHaveURL(/\/records$/);

  // A bookmark from the single-page ledger still opens where it pointed.
  await page.goto("/?tab=stats&statsRange=year");
  await expect(page).toHaveURL(/\/stats\?range=year$/);
  await expect(destination("统计")).toBeEnabled();

  expect(errors).toEqual([]);
});

test("Back closes the top dialog and leaves the page under it where it was", async ({ page }) => {
  await signIn(page);
  const navigation = page.getByRole("navigation", { name: "账本导航" });
  const destination = (name: string) => navigation.getByRole("button", { name, exact: true });
  await expect(destination("账目")).toBeEnabled();
  // 统计 sits under 账目 in history, where a swipe back from 记账 used to land.
  await destination("统计").click();
  await expect(page).toHaveURL(/\/stats$/);
  await destination("账目").click();
  await expect(page).toHaveURL(/\/records$/);

  const openNewRecord = page.getByRole("button", { name: "记账", exact: true }).first();
  await openNewRecord.click();
  const dialog = page.getByRole("dialog", { name: "记账" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/records\?new=1$/);
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/records$/);

  // Closing it with its own control pops the entry it pushed: Back then leaves
  // for 统计 in one step, with no dead entry in between.
  await openNewRecord.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/records$/);

  // Any other dialog is an entry of its own too.
  await showListControls(page);
  await page.getByRole("button", { name: "筛选", exact: true }).first().click();
  const filter = page.getByRole("dialog", { name: "筛选" });
  await expect(filter).toBeVisible();
  await page.goBack();
  await expect(filter).toHaveCount(0);
  await expect(page).toHaveURL(/\/records$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/stats$/);
});
