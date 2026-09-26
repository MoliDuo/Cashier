import { expect, test } from "@playwright/test";

test("unsaved input is kept as a draft and leaving never asks", async ({ page }, testInfo) => {
  const text = `Draft ${testInfo.project.name} ${Date.now()}`;
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel("密码", { exact: true }).fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // A typed record survives closing the dialog and a reload.
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  let dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", { name: /输入消费记录/ });
  await input.fill(text);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: /输入消费记录/ })).toHaveValue(text);
  const notice = dialog.getByRole("status").filter({ hasText: "有未保存的修改" }).first();
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "放弃", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: /输入消费记录/ })).toHaveValue("");
  await page.keyboard.press("Escape");

  // Browser back out of a detail with unsaved edits closes it without a prompt,
  // and reopening the record restores the edits.
  const name = `Draft record ${testInfo.project.name} ${Date.now()}`;
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "快速记账", exact: true }).click();
  await dialog.getByRole("textbox", { name: "名称（可选）", exact: true }).fill(name);
  await dialog.getByRole("group").getByRole("button").first().click();
  await dialog.getByRole("textbox", { name: "金额", exact: true }).fill("5.00");
  await dialog.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const card = page.getByTestId("source-document-card-root").filter({ hasText: name });
  await card.getByRole("button", { name, exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await dialog.getByRole("button", { name, exact: true }).first().click();
  await dialog.getByRole("textbox").first().fill(text);
  await dialog.getByRole("textbox").first().press("Enter");
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card.getByRole("button", { name, exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByText(text, { exact: true }).first()).toBeVisible();
  await dialog
    .getByRole("status")
    .filter({ hasText: "有未保存的修改" })
    .getByRole("button", { name: "放弃", exact: true })
    .click();
  await expect(dialog.getByText(text, { exact: true })).toHaveCount(0);
});

test("settings save as they change, with nothing to confirm on the way out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel("密码", { exact: true }).fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  const navigation = page.getByRole("navigation");
  await navigation.getByRole("button", { name: "设置", exact: true }).click();
  const prompt = page.getByRole("textbox", { name: "账本提示词", exact: true });
  const original = await prompt.inputValue();
  const next = `smoke prompt ${Date.now()}`;

  // Leaving the field saves it; switching tabs straight after asks nothing.
  await prompt.fill(next);
  await page.getByRole("switch", { name: "默认折叠记录", exact: true }).focus();
  await expect(page.getByText("设置更新成功").first()).toBeVisible();
  await navigation.getByRole("button", { name: "流水", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page.reload();
  await navigation.getByRole("button", { name: "设置", exact: true }).click();
  await expect(prompt).toHaveValue(next);
  await prompt.fill(original);
  await prompt.blur();
  await expect(prompt).toBeEnabled();
});
