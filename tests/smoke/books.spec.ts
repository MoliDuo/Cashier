import { expect, test, type Page } from "@playwright/test";
import { currentBookOption, openBookSwitcher, selectBook } from "./book-switch";

/**
 * Switches tab by keyboard. The demo runner serves `next dev`, whose error
 * overlay sits over the bottom-left nav on a phone and swallows the click that
 * "流水" needs; focusing the tab and pressing Enter is the same path a
 * keyboard user takes, and the overlay does not intercept it.
 */
async function switchTab(page: Page, name: string) {
  const tab = page
    .getByRole("navigation", { name: "账本导航" })
    .getByRole("button", { name, exact: true });
  await tab.focus();
  await page.keyboard.press("Enter");
}

/** Picks a book from the switcher by name, rather than by its position. */
async function selectBookByName(page: Page, name: string) {
  await openBookSwitcher(page);
  await page
    .getByRole("group", { name: "分账" })
    .getByRole("button")
    .filter({ hasText: name })
    .click();
  await expect(page.getByTestId("book-reveal")).toHaveAttribute("data-pull-reveal", "closed");
}

/**
 * The row of the 分账 list that names `name`. Matched on the exact name, not a
 * substring, so one book cannot be confused with another that starts the same.
 */
function bookRow(page: Page, name: string) {
  return page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
}

/** Archives through the confirmation, which is the only path that may retire a book. */
async function archiveBook(page: Page, name: string) {
  await bookRow(page, name).getByRole("button", { name: "归档", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "归档", exact: true }).click();
}

test("there is no web setup, and an enrollment link nobody issued is refused", async ({ page }) => {
  // Accounts come from `account:create`; enrollment itself is covered by
  // tests/integration/auth/enrollment.test.ts.
  const response = await page.goto("/setup");
  expect(response?.status()).toBe(404);

  await page.goto(`/enroll?token=${"A".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "链接不可用" })).toBeVisible();
  await expect(page.getByRole("button", { name: "创建通行密钥" })).toHaveCount(0);
});

/**
 * The book switcher and the per-book bookkeeping that replaced the member
 * switch: 总账 is the sum of the books, a record can be filed into a chosen
 * book, and moving it from its detail page follows it between books.
 *
 * These run against the demo workspace, which is the only environment with
 * more than one book.
 */
test("@demo files a record into a book and moves it to another", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const item = `Booked in 梁梁 ${testInfo.project.name}`;

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "以开发身份进入", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // 总账 shows the seeded books' records together.
  await expect(page.getByText("Harbor Coffee", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("FreshMart", { exact: true }).first()).toBeVisible();

  // Recording from 总账 opens the picker on the first book in 设置 order,
  // 共同支出, unless it is changed for that one record.
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByRole("button", { name: "快速记账", exact: true }).click();
  const bookPicker = create.getByLabel("分账", { exact: true });
  await expect(bookPicker).toHaveText(/共同支出/);
  // Radix sets `pointer-events: none` on the trigger while its listbox is open
  // and portals the listbox to the body, so it is opened with the keyboard and
  // the option is read from the page rather than from inside the dialog.
  await bookPicker.press("ArrowDown");
  await page.getByRole("option", { name: "梁梁" }).click();
  await create.getByRole("textbox", { name: "名称（可选）", exact: true }).fill(item);
  await create.getByRole("group").getByRole("button").first().click();
  await create.getByRole("textbox", { name: "金额", exact: true }).fill("33.00");
  await create.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(create).toHaveCount(0);
  await expect(page.getByText(item, { exact: true }).first()).toBeVisible();

  // It is in 梁梁 and not in 哞哞: the books are separate views of 总账. The
  // strip runs 总账 / 共同支出 / 哞哞 / 梁梁, so the positions below name the two
  // personal books.
  await selectBook(page, 2);
  await expect(page.getByText(item, { exact: true }).first()).toBeVisible();
  await selectBook(page, 1);
  await expect(page.getByText(item, { exact: true })).toHaveCount(0);

  // Moving it from its detail page follows it into the other book.
  await selectBook(page, "all");
  await page
    .getByTestId("source-document-card-root")
    .filter({ hasText: item })
    .getByRole("button", { name: item, exact: true })
    .click();
  const detail = page.getByRole("dialog").first();
  const detailBook = detail.getByLabel("分账", { exact: true });
  await expect(detailBook).toHaveText(/梁梁/);
  await detailBook.press("ArrowDown");
  await page.getByRole("option", { name: "哞哞" }).click();
  await detail.getByRole("button", { name: "关闭", exact: true }).click();

  await selectBook(page, 1);
  await expect(page.getByText(item, { exact: true }).first()).toBeVisible();
  await selectBook(page, 2);
  await expect(page.getByText(item, { exact: true })).toHaveCount(0);
  await selectBook(page, "all");

  expect(errors).toEqual([]);
});

test("@demo manages books and the book each API key writes to", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "以开发身份进入", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page
    .getByRole("navigation", { name: "账本导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();

  // 分账 section: the three seeded books, each with its zone. 总账 is a view
  // over all of them, so nothing here marks a default any more.
  await expect(page.getByRole("heading", { name: "分账", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "上移 梁梁", exact: true })).toBeVisible();
  await expect(page.getByText("Asia/Shanghai", { exact: true }).first()).toBeVisible();
  await expect(bookRow(page, "共同支出").getByText("合计", { exact: true })).toHaveCount(0);
  // The former 总账 default is an ordinary book: nothing stops retiring it
  // (it is not clicked, the demo workspace is shared).
  await expect(
    bookRow(page, "共同支出").getByRole("button", { name: "归档", exact: true })
  ).toBeEnabled();

  // Each key carries the book it writes to on its own picker, because uploads
  // follow the key; nothing repeats the book's name in words beside it.
  await expect(
    page.getByRole("combobox", { name: "修改「Shortcuts automation」的分账", exact: true })
  ).toHaveText("哞哞");
  await expect(
    page.getByRole("combobox", { name: "修改「Partner shortcut」的分账", exact: true })
  ).toHaveText("梁梁");

  // The login-email section lists the demo account's address, and refuses to
  // remove the last one.
  await expect(page.getByText("dev@cashier.local", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "移除 dev@cashier.local", exact: true })
  ).toBeDisabled();

  expect(errors).toEqual([]);
});

test("@demo the view remembers the device's last choice", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "以开发身份进入", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // A first visit shows 总账: every book's records together.
  await expect(currentBookOption(page)).toHaveText("总账");

  // Switching to 梁梁 is remembered by the device, not by the URL.
  await selectBookByName(page, "梁梁");
  await expect(currentBookOption(page)).toHaveText("梁梁");

  // A reload stays on it, and so does a second tab of the same browser.
  await page.reload();
  await expect(currentBookOption(page)).toHaveText("梁梁");
  const secondTab = await context.newPage();
  await secondTab.goto("/");
  await expect(currentBookOption(secondTab)).toHaveText("梁梁");
  await secondTab.close();

  expect(errors).toEqual([]);
});

test("@demo the record picker remembers the book a record was saved into", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const item = `Picker memory ${Date.now()}`;

  await page.goto("/");
  await page.getByRole("button", { name: "以开发身份进入", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  const openDialog = async () => {
    await page.getByRole("button", { name: "记一笔", exact: true }).click();
    return page.getByRole("dialog");
  };

  // A first open selects the first book in 设置 order, 共同支出.
  let create = await openDialog();
  await create.getByRole("button", { name: "快速记账", exact: true }).click();
  let bookPicker = create.getByLabel("分账", { exact: true });
  await expect(bookPicker).toHaveText(/共同支出/);

  // Save one record into 哞哞.
  await bookPicker.press("ArrowDown");
  await page.getByRole("option", { name: "哞哞" }).click();
  await create.getByRole("textbox", { name: "名称（可选）", exact: true }).fill(item);
  await create.getByRole("group").getByRole("button").first().click();
  await create.getByRole("textbox", { name: "金额", exact: true }).fill("12.00");
  await create.getByRole("button", { name: "记一笔", exact: true }).click();
  await expect(create).toHaveCount(0);

  // The next open starts from that save.
  create = await openDialog();
  bookPicker = create.getByLabel("分账", { exact: true });
  await expect(bookPicker).toHaveText(/哞哞/);

  // Changing the pick and cancelling is not "the last choice".
  await bookPicker.press("ArrowDown");
  await page.getByRole("option", { name: "共同支出" }).click();
  await expect(bookPicker).toHaveText(/共同支出/);
  await page.keyboard.press("Escape");
  await expect(create).toHaveCount(0);

  create = await openDialog();
  await expect(create.getByLabel("分账", { exact: true })).toHaveText(/哞哞/);
  await page.keyboard.press("Escape");
  await expect(create).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("@demo deletes, archives and restores a book it creates for itself", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The demo workspace is shared by every project in this file, so this test
  // brings its own book and removes it again instead of retiring a seeded one.
  // The rules that need a book with records or a bound key are pinned in
  // tests/integration/ledger/books-adapter.test.ts, where fixtures are free.
  const bookName = "临时甲账";

  await page.goto("/");
  await page.getByRole("button", { name: "以开发身份进入", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page
    .getByRole("navigation", { name: "账本导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "分账", exact: true })).toBeVisible();

  // A key is still bound to 梁梁, so archiving it is refused with the reason,
  // and the refusal changes nothing.
  await archiveBook(page, "梁梁");
  await expect(page.getByText(/Rebind them first/)).toBeVisible();
  await expect(bookRow(page, "梁梁").getByRole("button", { name: "归档" })).toBeEnabled();

  // Create the book this test owns.
  await page.getByRole("button", { name: "新增分账", exact: true }).click();
  await page.getByRole("dialog").getByLabel("名称", { exact: true }).fill(bookName);
  await page.getByRole("dialog").getByRole("button", { name: "新增分账", exact: true }).click();
  await expect(bookRow(page, bookName)).toBeVisible();

  // Archive it: it leaves the live list and appears under the archived heading,
  // which is also where it is brought back from.
  await archiveBook(page, bookName);
  await expect(page.getByRole("heading", { name: "已归档的分账", exact: true })).toBeVisible();
  await expect(bookRow(page, bookName).getByText("已归档", { exact: true })).toBeVisible();
  // Only the archived row offers Restore, so this is the row that must be there —
  // and no live row may keep offering Archive for the same book.
  await expect(bookRow(page, bookName).getByRole("button", { name: "恢复" })).toBeVisible();
  await expect(bookRow(page, bookName).getByRole("button", { name: "归档" })).toHaveCount(0);
  await bookRow(page, bookName).getByRole("button", { name: "恢复", exact: true }).click();
  await expect(bookRow(page, bookName).getByRole("button", { name: "归档" })).toBeVisible();

  // An empty book can be deleted outright, and deletion is final.
  await bookRow(page, bookName).getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(bookRow(page, bookName)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("@demo archiving the book being viewed falls back to the ledger total", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const bookName = "临时乙账";

  await page.goto("/");
  await page.getByRole("button", { name: "以开发身份进入", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page
    .getByRole("navigation", { name: "账本导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByRole("button", { name: "新增分账", exact: true }).click();
  await page.getByRole("dialog").getByLabel("名称", { exact: true }).fill(bookName);
  await page.getByRole("dialog").getByRole("button", { name: "新增分账", exact: true }).click();
  await expect(bookRow(page, bookName)).toBeVisible();

  // Narrow the records view to that book.
  await switchTab(page, "流水");
  await selectBookByName(page, bookName);
  await expect(currentBookOption(page)).toHaveText(bookName);

  // Retiring it from Settings drops the scope: it can no longer name a live
  // book, so the records view falls back to 总账 rather than keeping a book that
  // is gone.
  await page
    .getByRole("navigation", { name: "账本导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await archiveBook(page, bookName);
  await expect(page.getByRole("heading", { name: "已归档的分账", exact: true })).toBeVisible();
  await switchTab(page, "流水");
  // The dead scope is gone once the strip marks 总账 again.
  await expect(currentBookOption(page)).toHaveText("总账");

  // Leave the workspace as it was found: restore the book, then remove it.
  await page
    .getByRole("navigation", { name: "账本导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await bookRow(page, bookName).getByRole("button", { name: "恢复", exact: true }).click();
  await bookRow(page, bookName).getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(bookRow(page, bookName)).toHaveCount(0);

  expect(errors).toEqual([]);
});
