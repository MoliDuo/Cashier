import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test("账目 and 统计 are routes of their own, Back walks them, and old links land on them", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  await expect(page).toHaveURL(/\/records$/);

  const navigation = page.getByRole("navigation", { name: "账本导航" });
  const destination = (name: string) => navigation.getByRole("button", { name, exact: true });
  await expect(destination("账目")).toBeEnabled();

  // The two views of 账目 are one route; the view is part of its query.
  await page
    .getByRole("group", { name: "账目视图" })
    .getByRole("button", { name: "按明细", exact: true })
    .click();
  await expect(page).toHaveURL(/\/records\?view=entries$/);
  await destination("统计").click();
  await expect(page).toHaveURL(/\/stats$/);
  // 设置 is the gear in the top bar, and its back arrow returns to 统计.
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page).toHaveURL(/\/stats$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/stats$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/records\?view=entries$/);

  // 流水 and 明细 became the two views of 账目, and their links follow.
  await page.goto("/details?search=tea");
  await expect(page).toHaveURL(/\/records\?view=entries&search=tea$/);
  await page.goto("/stream");
  await expect(page).toHaveURL(/\/records$/);

  // A bookmark from the single-page ledger still opens where it pointed.
  await page.goto("/?tab=stats&statsRange=year");
  await expect(page).toHaveURL(/\/stats\?range=year$/);
  await expect(destination("统计")).toBeEnabled();

  expect(errors).toEqual([]);
});
