import { expect, test } from "@playwright/test";
import { openTab } from "./navigation";
import { seedRecord } from "./seed-record";
import { signIn } from "./sign-in";

test("unsaved input is kept as a draft and leaving never asks", async ({ page }, testInfo) => {
  const text = `Draft ${testInfo.project.name} ${Date.now()}`;
  await signIn(page);

  // A typed record survives closing the dialog and a reload.
  await page.getByRole("button", { name: "记账", exact: true }).click();
  let dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", { name: /收支内容/ });
  await input.fill(text);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "记账", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: /收支内容/ })).toHaveValue(text);
  const notice = dialog.getByRole("status").filter({ hasText: "有未保存的修改" }).first();
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "放弃", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: /收支内容/ })).toHaveValue("");
  await page.keyboard.press("Escape");

  // A record's fields are written as they change, so Back out of its sheet
  // closes it without a prompt and the change is already on the list.
  const name = `Draft record ${testInfo.project.name} ${Date.now()}`;
  await seedRecord(page, { item: name, amount: "5.00" });
  const card = page.getByTestId("source-document-card-root").filter({ hasText: name });
  await card.getByRole("button", { name, exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name, exact: true }).first().click();
  const title = dialog.getByRole("textbox", { name: "账单标题", exact: true });
  await title.fill(text);
  await title.press("Enter");
  await expect(dialog.getByRole("button", { name: text, exact: true }).first()).toBeEnabled();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByTestId("source-document-card-root").filter({ hasText: text })
  ).toBeVisible();
});

test("settings save as they change, with nothing to confirm on the way out", async ({ page }) => {
  await signIn(page);

  await openTab(page, "设置");
  const prompt = page.getByRole("textbox", { name: "账本提示词", exact: true });
  const original = await prompt.inputValue();
  const next = `smoke prompt ${Date.now()}`;

  // Leaving the field saves it; switching tabs straight after asks nothing.
  await prompt.fill(next);
  await page.getByRole("switch", { name: "默认折叠账单", exact: true }).focus();
  await expect(page.getByText("设置更新成功").first()).toBeVisible();
  await openTab(page, "账目");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page.reload();
  await openTab(page, "设置");
  await expect(prompt).toHaveValue(next);
  await prompt.fill(original);
  await prompt.blur();
  await expect(prompt).toBeEnabled();
});
