import { expect, test, type Locator } from "@playwright/test";
import { signIn } from "./sign-in";

test("selection, discard confirmation and one-tap split navigation", async ({
  page,
  isMobile,
}, testInfo) => {
  const activate = (locator: Locator) => (isMobile ? locator.tap() : locator.click());
  const name = `Interaction ${testInfo.project.name}`;
  await signIn(page);
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "快速记账", exact: true }).click();
  await dialog.getByRole("textbox", { name: "名称（可选）", exact: true }).fill(name);
  await dialog.getByRole("group").getByRole("button").first().click();
  await dialog.getByRole("textbox", { name: "金额", exact: true }).fill("12.34");
  await dialog.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const initialCard = page.getByTestId("source-document-card-root").filter({ hasText: name });
  await expect(initialCard).toBeVisible();
  const id = await initialCard.getAttribute("data-source-document-id");
  const card = page.locator(`[data-source-document-id="${id}"]`);
  await activate(page.getByRole("button", { name: "选择", exact: true }));
  const surface = page.locator('[data-selection-mode="true"]').filter({ has: card });
  const expand = surface.getByRole("button", { name: "折叠", exact: true });
  await expect(expand).toHaveCount(1);
  const expandBox = await expand.boundingBox();
  expect(expandBox!.width + 0.001).toBeGreaterThanOrEqual(44);
  expect(expandBox!.height + 0.001).toBeGreaterThanOrEqual(44);
  await activate(surface.getByRole("checkbox"));
  await activate(expand);
  await expect(surface.getByRole("checkbox")).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("stream-selection.png"), fullPage: true });
  await activate(page.getByRole("button", { name: "取消", exact: true }));
  await card.getByRole("button", { name, exact: true }).click();
  dialog = page.getByRole("dialog");
  // The header holds the title and the close button, so the title has to stop
  // before the close control starts.
  const titleBox = await dialog.getByText(name, { exact: true }).first().boundingBox();
  const closeBox = await dialog.getByRole("button", { name: "关闭", exact: true }).boundingBox();
  expect(titleBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(closeBox!.x);
  await dialog.getByRole("button", { name: "选择", exact: true }).click();
  const row = dialog.getByRole("checkbox", { name: `选择${name}`, exact: true });
  await activate(row);
  await expect(dialog.getByRole("button", { name: "删除", exact: true }).first()).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("detail-selection.png"), fullPage: true });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  // A field swaps from its display button to an input when it is clicked.
  await dialog.getByRole("button", { name, exact: true }).first().click();
  await dialog.getByRole("textbox").first().fill("Discard this title");
  await dialog.getByRole("textbox").first().press("Enter");
  await dialog.getByRole("button", { name: "取消编辑", exact: true }).click();
  await expect(page.getByRole("dialog").last()).toContainText("有未保存的修改");
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "继续编辑", exact: true })
    .click();
  await dialog.getByRole("button", { name: "取消编辑", exact: true }).click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "放弃修改", exact: true })
    .click();
  await expect(dialog.getByText("Discard this title", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await dialog.getByRole("button", { name: "添加明细", exact: true }).click();
  const add = page.getByRole("dialog").last();
  await add.getByLabel("名称", { exact: true }).fill("Second item");
  await add.getByLabel("金额", { exact: true }).fill("2.00");
  await add.getByRole("button", { name: "添加明细", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "选择", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "添加明细", exact: true }).click();
  await add.getByLabel("名称", { exact: true }).fill("Third item");
  await add.getByLabel("金额", { exact: true }).fill("3.00");
  await add.getByRole("button", { name: "添加明细", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "选择", exact: true })).toBeEnabled();
  await expect(dialog.getByText("Third item", { exact: true })).toBeVisible();
  let releaseRefresh!: () => void;
  let heldReads = 0;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/api/ledger-queries", async (route) => {
    const query = route.request().postDataJSON().query;
    if (["detail", "stream", "total", "summary", "stats"].includes(query)) {
      heldReads++;
      await refreshGate;
    }
    await route.continue();
  });
  await dialog.getByRole("button", { name: "选择", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "选择Second item", exact: true }).click();
  await dialog.getByRole("button", { name: "拆分", exact: true }).click();
  const firstSplitStarted = Date.now();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "拆分账单", exact: true })
    .click();
  await expect(dialog.getByRole("checkbox", { name: `选择${name}`, exact: true })).toBeEnabled({
    timeout: 5_000,
  });
  const firstSplitMs = Date.now() - firstSplitStarted;
  await expect(dialog.getByRole("checkbox", { name: "选择Second item", exact: true })).toHaveCount(
    0
  );
  await expect.poll(() => heldReads).toBeGreaterThan(0);
  // The next split must not wait for any list, stats, or detail read to finish.
  await dialog.getByRole("checkbox", { name: "选择Third item", exact: true }).click();
  await dialog.getByRole("button", { name: "拆分", exact: true }).click();
  const secondSplitStarted = Date.now();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "拆分账单", exact: true })
    .click();
  await expect(dialog.getByRole("checkbox", { name: `选择${name}`, exact: true })).toBeEnabled({
    timeout: 5_000,
  });
  await expect(dialog.getByRole("checkbox", { name: "选择Third item", exact: true })).toHaveCount(
    0
  );
  await page.screenshot({ path: testInfo.outputPath("continuous-split.png"), fullPage: true });
  await testInfo.attach("split-timing", {
    body: JSON.stringify({
      firstSplitMs,
      secondSplitMs: Date.now() - secondSplitStarted,
      heldReads,
    }),
    contentType: "application/json",
  });
  releaseRefresh();
  const originalUrl = page.url();
  await expect(page.getByRole("button", { name: "查看新账单", exact: true })).toHaveCount(1);
  const jump = page.getByRole("button", { name: "查看新账单", exact: true }).first();
  await expect(jump).toBeVisible();
  const jumpBox = await jump.boundingBox();
  expect(jumpBox!.height + 0.001).toBeGreaterThanOrEqual(44);
  await activate(jump);
  await expect(page).not.toHaveURL(originalUrl);
  // The bill being left behind is still in the DOM while it animates out.
  await expect(page.getByRole("dialog").last()).toContainText("Third item");
  await page.screenshot({ path: testInfo.outputPath("split-navigation.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("dialog").last()).toContainText("Third item");
});
