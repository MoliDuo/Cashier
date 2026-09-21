import { expect, test } from "@playwright/test";

test("AI category assignment remains visible across tabs and fits narrow screens", async ({
  page,
  isMobile,
}, testInfo) => {
  const isShortMobile = testInfo.project.name === "short-mobile";
  if (isMobile && !isShortMobile) await page.setViewportSize({ width: 390, height: 844 });
  const item = `Category workflow ${testInfo.project.name}`;

  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel("密码", { exact: true }).fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByRole("button", { name: "快速记账", exact: true }).click();
  await create.getByRole("textbox", { name: "名称（可选）", exact: true }).fill(item);
  await create.getByRole("group").getByRole("button").first().click();
  await create.getByRole("textbox", { name: "金额", exact: true }).fill("12.34");
  await create.getByRole("button", { name: "记一笔", exact: true }).click();

  const navigation = page.getByRole("navigation", { name: "账本导航" });
  await navigation.getByRole("button", { name: "明细", exact: true }).click();
  await expect(page.getByText(item, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await page.getByRole("checkbox", { name: `选择${item}`, exact: true }).click();
  await page.getByRole("button", { name: /^(设置分类|分类)$/ }).click();

  const categoryDialog = page.getByRole("dialog");
  await expect(categoryDialog.getByRole("heading", { name: "设置分类" })).toBeVisible();
  const candidates = categoryDialog.getByRole("checkbox");
  await candidates.nth(1).click();
  await candidates.nth(2).click();
  const confirm = categoryDialog.getByRole("button", { name: "AI 分类 1 条明细" });

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

  await navigation.getByRole("button", { name: "设置", exact: true }).click();
  await expect(status).toBeVisible();
  await navigation.getByRole("button", { name: "明细", exact: true }).click();
  await expect(status).toBeVisible();
  await expect(status).toContainText(/已更新 1 条，0 条已符合目标分类/, { timeout: 20_000 });

  await status.getByRole("button", { name: "查看结果", exact: true }).click();
  const results = page.getByRole("dialog");
  await expect(results.getByText(item, { exact: true })).toBeVisible();
  await expect(results.getByText("已更新", { exact: true })).toBeVisible();
  await results.getByRole("button", { name: "关闭", exact: true }).first().click();
  await expect(results).toHaveCount(0);

  // A finished run reports itself until the reader closes it, and then stays closed.
  await status.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(status).toHaveCount(0);
  await navigation.getByRole("button", { name: "设置", exact: true }).click();
  await expect(status).toHaveCount(0);
  await navigation.getByRole("button", { name: "明细", exact: true }).click();
  await expect(status).toHaveCount(0);
});
