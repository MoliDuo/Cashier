import { expect, test, type Locator } from "@playwright/test";
import { showListControls } from "./navigation";
import { signIn } from "./sign-in";

test("selection, instant edits and one-tap split navigation", async ({
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
  await dialog.getByRole("group", { name: "选择分类" }).getByRole("button").first().click();
  await dialog.getByRole("textbox", { name: "金额", exact: true }).fill("12.34");
  await dialog.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const initialCard = page.getByTestId("source-document-card-root").filter({ hasText: name });
  await expect(initialCard).toBeVisible();
  const id = await initialCard.getAttribute("data-source-document-id");
  const card = page.locator(`[data-source-document-id="${id}"]`);
  const title = card.getByRole("button", { name, exact: true });
  // The header's total comes before the entry rows, which repeat the amount.
  const total = card.getByText(/12\.34/).first();
  const chevronBefore = await card.getByRole("button", { name: "折叠", exact: true }).boundingBox();
  const totalBefore = await total.boundingBox();
  await showListControls(page);
  await activate(page.getByRole("button", { name: "选择", exact: true }));
  const surface = page.locator('[data-selection-mode="true"]').filter({ has: card });
  const expand = surface.getByRole("button", { name: "折叠", exact: true });
  await expect(expand).toHaveCount(1);
  const expandBox = await expand.boundingBox();
  expect(expandBox!.width + 0.001).toBeGreaterThanOrEqual(44);
  expect(expandBox!.height + 0.001).toBeGreaterThanOrEqual(44);
  // Selecting keeps the chevron where it was, clear of the title, and the
  // total does not move to fill its place.
  const centre = (box: { x: number; width: number }) => box.x + box.width / 2;
  expect(Math.abs(centre(expandBox!) - centre(chevronBefore!))).toBeLessThanOrEqual(2);
  const titleText = await title.locator("span span").boundingBox();
  expect(titleText!.x + titleText!.width).toBeLessThanOrEqual(expandBox!.x);
  expect(Math.abs((await total.boundingBox())!.x - totalBefore!.x)).toBeLessThanOrEqual(1);
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
  // Adding an entry is always on offer; there is no edit mode to enter first.
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
  // The new bill replaces the one it was split from; the sheets never stack.
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toContainText("Third item");
  await page.screenshot({ path: testInfo.outputPath("split-navigation.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText("Third item");
  // Closing lands on the list the first bill was opened from.
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/detail=/);
});

test("the period choices keep one line each at 360px", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone width only");
  await page.setViewportSize({ width: 360, height: 780 });
  await signIn(page);
  await showListControls(page);
  await page
    .getByRole("button", { name: /^区间：/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "选择区间" });
  // One line of 14px text sits inside the 36px control; a label that breaks
  // onto a second line makes its button taller than that.
  for (const label of ["周", "月", "年", "全部", "自定义"]) {
    const box = await dialog.getByRole("button", { name: label, exact: true }).boundingBox();
    expect(box!.height).toBeLessThanOrEqual(36.5);
  }
});
