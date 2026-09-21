import { expect, test } from "@playwright/test";

test("password login, default ledger, manual entry, edit, delete and sign out", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const item = `Smoke ${testInfo.project.name} ${testInfo.repeatEachIndex}`;
  // Every tab refreshes by tapping the destination it is already on, and the
  // destinations stay disabled until the tab content has hydrated — so the
  // stream destination doubles as the signal that the page is ready.
  const refreshControl = page
    .getByRole("navigation", { name: "账本导航" })
    .getByRole("button", { name: "流水", exact: true });
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get("/login")).status();
        } catch {
          return 0;
        }
      },
      { timeout: 30_000 }
    )
    .toBe(200);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel("密码", { exact: true }).fill("Wrong-password9");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" })).toBeVisible();
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
  await expect(create).toHaveCount(0);
  await page.reload();
  await expect(refreshControl).toBeEnabled();
  await page
    .getByTestId("source-document-card-root")
    .filter({ hasText: item })
    .getByRole("button", { name: item, exact: true })
    .click();
  const detail = page.getByRole("dialog").first();
  await detail.getByRole("button", { name: "编辑", exact: true }).click();
  // A field swaps from its display button to an input when it is clicked.
  await detail.getByRole("button", { name: item, exact: true }).first().click();
  const title = detail.getByRole("textbox").first();
  await title.fill(`${item} edited`);
  await title.press("Enter");
  await detail.getByRole("button", { name: /^保存 \(/ }).click();
  await expect(detail.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("dialog").first().getByText(`${item} edited`, { exact: true }).first()
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("detail.png"), fullPage: true });
  await page.getByRole("dialog").first().getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/detailId=/);
  await page.reload();
  await expect(page.getByText(`${item} edited`, { exact: true })).toHaveCount(0);
  await expect(refreshControl).toBeEnabled();
  await page
    .getByRole("navigation", { name: "账本导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  expect(errors).toEqual([]);
});
