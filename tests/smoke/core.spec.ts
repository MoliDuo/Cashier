import { expect, test } from "@playwright/test";
import { openTab } from "./navigation";
import { signIn } from "./sign-in";

test("protected redirect, default ledger, manual entry, edit, delete and sign out", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const item = `Smoke ${testInfo.project.name} ${testInfo.repeatEachIndex}`;
  // The destinations stay disabled until the tab content has hydrated, so the
  // 账目 destination doubles as the signal that the page is ready.
  const readySignal = page
    .getByRole("navigation", { name: "账本导航" })
    .getByRole("button", { name: "账目", exact: true });
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
  await signIn(page);
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByRole("button", { name: "快速记账", exact: true }).click();
  await create.getByRole("textbox", { name: "名称（可选）", exact: true }).fill(item);
  await create.getByRole("group", { name: "选择分类" }).getByRole("button").first().click();
  await create.getByRole("textbox", { name: "金额", exact: true }).fill("12.34");
  await create.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(create).toHaveCount(0);
  await page.reload();
  await expect(readySignal).toBeEnabled();
  await page
    .getByTestId("source-document-card-root")
    .filter({ hasText: item })
    .getByRole("button", { name: item, exact: true })
    .click();
  const detail = page.getByRole("dialog").first();
  // The title swaps from its display button to an input when it is clicked,
  // and Enter writes it; there is no edit mode and nothing else to save.
  await detail.getByRole("button", { name: item, exact: true }).first().click();
  const title = detail.getByRole("textbox", { name: "账单标题", exact: true });
  await title.fill(`${item} edited`);
  await title.press("Enter");
  await expect(
    detail.getByRole("button", { name: `${item} edited`, exact: true }).first()
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("dialog").first().getByText(`${item} edited`, { exact: true }).first()
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("detail.png"), fullPage: true });
  await page.getByRole("dialog").first().getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "删除账单", exact: true }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/detail=/);
  await page.reload();
  await expect(page.getByText(`${item} edited`, { exact: true })).toHaveCount(0);
  await expect(readySignal).toBeEnabled();
  await openTab(page, "设置");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  expect(errors).toEqual([]);
});
