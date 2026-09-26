import { expect, test } from "@playwright/test";

test("each tab is its own route, Back walks them, and old bookmarks land on them", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel("密码", { exact: true }).fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/stream$/);

  const navigation = page.getByRole("navigation", { name: "账本导航" });
  const destination = (name: string) => navigation.getByRole("button", { name, exact: true });
  await expect(destination("流水")).toBeEnabled();

  await destination("明细").click();
  await expect(page).toHaveURL(/\/details$/);
  await destination("统计").click();
  await expect(page).toHaveURL(/\/stats$/);
  await destination("设置").click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/stats$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/details$/);

  // A bookmark from the single-page ledger still opens where it pointed.
  await page.goto("/?tab=stats&statsRange=year");
  await expect(page).toHaveURL(/\/stats\?range=year$/);
  await expect(destination("统计")).toBeEnabled();

  expect(errors).toEqual([]);
});
