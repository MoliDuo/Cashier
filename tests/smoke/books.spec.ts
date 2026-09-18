import { expect, test, type Page } from "@playwright/test";
import { openBookScope, selectBook } from "./book-switch";

/**
 * Switches tab by keyboard. The demo runner serves `next dev`, whose error
 * overlay sits over the bottom-left nav on a phone and swallows the click that
 * "Stream" needs; focusing the tab and pressing Enter is the same path a
 * keyboard user takes, and the overlay does not intercept it.
 */
async function switchTab(page: Page, name: string) {
  const tab = page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name, exact: true });
  await tab.focus();
  await page.keyboard.press("Enter");
}

/** Picks a book from the switcher by name, rather than by its position. */
async function selectBookByName(page: Page, name: string) {
  await openBookScope(page);
  await page
    .getByRole("group", { name: "Book" })
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
  await bookRow(page, name).getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
}

/**
 * The book switcher and the per-book bookkeeping that replaced the member
 * switch: 总账 is the sum of the books, a record can be filed into a chosen
 * book, and moving it from its detail page follows it between books.
 *
 * These run against the demo workspace, which is the only environment with
 * more than one book.
 */
test("first-run setup is closed once an account exists", async ({ page }) => {
  // The smoke database is seeded with an account, so the wizard's window has
  // passed. The wizard's own transaction is covered by
  // tests/integration/auth/login-emails-and-setup.test.ts, because reaching it
  // end to end needs an empty database, which this runner deliberately avoids.
  const response = await page.goto("/en/setup");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toHaveCount(0);
});

test("@demo files a record into a book and moves it to another", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const item = `Booked in 梁梁的 ${testInfo.project.name}`;

  await page.goto("/en");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "Continue as dev", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // 总账 shows the seeded books' records together.
  await expect(page.getByText("Harbor Coffee", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("FreshMart", { exact: true }).first()).toBeVisible();

  // Recording from 总账 lands in the default book, 共同支出, unless the picker
  // is changed for that one record.
  await page.getByRole("button", { name: "New Record", exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByRole("button", { name: "Quick Entry", exact: true }).click();
  const bookPicker = create.getByLabel("Book", { exact: true });
  await expect(bookPicker).toHaveText(/共同支出/);
  // Radix sets `pointer-events: none` on the trigger while its listbox is open
  // and portals the listbox to the body, so it is opened with the keyboard and
  // the option is read from the page rather than from inside the dialog.
  await bookPicker.press("ArrowDown");
  await page.getByRole("option", { name: "梁梁的" }).click();
  await create.getByRole("textbox", { name: "Item name (optional)", exact: true }).fill(item);
  await create.getByRole("group").getByRole("button").first().click();
  await create.getByRole("textbox", { name: "Amount", exact: true }).fill("33.00");
  await create.getByRole("button", { name: "Record", exact: true }).click();
  await expect(create).toHaveCount(0);
  await expect(page.getByText(item, { exact: true }).first()).toBeVisible();

  // It is in 梁梁的 and not in 哞哞的: the books are separate views of 总账.
  await selectBook(page, 1);
  await expect(page.getByText(item, { exact: true }).first()).toBeVisible();
  await selectBook(page, 0);
  await expect(page.getByText(item, { exact: true })).toHaveCount(0);

  // Moving it from its detail page follows it into the other book.
  await selectBook(page, "all");
  await page
    .getByTestId("source-document-card-root")
    .filter({ hasText: item })
    .getByRole("button", { name: item, exact: true })
    .click();
  const detail = page.getByRole("dialog").first();
  const detailBook = detail.getByLabel("Book", { exact: true });
  await expect(detailBook).toHaveText(/梁梁的/);
  await detailBook.press("ArrowDown");
  await page.getByRole("option", { name: "哞哞的" }).click();
  await detail.getByRole("button", { name: "Close", exact: true }).click();

  await selectBook(page, 0);
  await expect(page.getByText(item, { exact: true }).first()).toBeVisible();
  await selectBook(page, 1);
  await expect(page.getByText(item, { exact: true })).toHaveCount(0);
  await selectBook(page, "all");

  expect(errors).toEqual([]);
});

test("@demo manages books and the book each API key writes to", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/en");
  await page.getByRole("button", { name: "Continue as dev", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();

  // 分账 section: the three seeded books, each with its zone, and the 总账
  // default marked on 共同支出.
  await expect(page.getByRole("heading", { name: "Books", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move 梁梁的 up", exact: true })).toBeVisible();
  await expect(page.getByText("Asia/Shanghai", { exact: true }).first()).toBeVisible();

  // Each key names the book it writes to, because uploads follow the key.
  await expect(page.getByText("Writes to 哞哞的", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Writes to 梁梁的", { exact: true }).first()).toBeVisible();

  // The login-email section lists the demo account's address, and refuses to
  // remove the last one.
  await expect(page.getByText("dev@cashier.local", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove dev@cashier.local", exact: true })
  ).toBeDisabled();

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

  await page.goto("/en");
  await page.getByRole("button", { name: "Continue as dev", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Books", exact: true })).toBeVisible();

  // A key is still bound to 梁梁的, so archiving it is refused with the reason,
  // and the refusal changes nothing.
  await archiveBook(page, "梁梁的");
  await expect(page.getByText(/Rebind them first/)).toBeVisible();
  await expect(bookRow(page, "梁梁的").getByRole("button", { name: "Archive" })).toBeEnabled();

  // Create the book this test owns.
  await page.getByRole("button", { name: "Add book", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(bookName);
  await page.getByRole("dialog").getByRole("button", { name: "Add book", exact: true }).click();
  await expect(bookRow(page, bookName)).toBeVisible();

  // Archive it: it leaves the live list and appears under the archived heading,
  // which is also where it is brought back from.
  await archiveBook(page, bookName);
  await expect(page.getByRole("heading", { name: "Archived books", exact: true })).toBeVisible();
  await expect(bookRow(page, bookName).getByText("Archived", { exact: true })).toBeVisible();
  // Only the archived row offers Restore, so this is the row that must be there —
  // and no live row may keep offering Archive for the same book.
  await expect(bookRow(page, bookName).getByRole("button", { name: "Restore" })).toBeVisible();
  await expect(bookRow(page, bookName).getByRole("button", { name: "Archive" })).toHaveCount(0);
  await bookRow(page, bookName).getByRole("button", { name: "Restore", exact: true }).click();
  await expect(bookRow(page, bookName).getByRole("button", { name: "Archive" })).toBeVisible();

  // An empty book can be deleted outright, and deletion is final.
  await bookRow(page, bookName).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(bookRow(page, bookName)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("@demo archiving the book being viewed falls back to the ledger total", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const bookName = "临时乙账";

  await page.goto("/en");
  await page.getByRole("button", { name: "Continue as dev", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Add book", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(bookName);
  await page.getByRole("dialog").getByRole("button", { name: "Add book", exact: true }).click();
  await expect(bookRow(page, bookName)).toBeVisible();

  // Narrow the records view to that book.
  await switchTab(page, "Stream");
  await selectBookByName(page, bookName);
  await expect(page.getByTestId("book-scope-chip")).toContainText(bookName);

  // Retiring it from Settings drops the scope: it can no longer name a live
  // book, so the records view falls back to 总账 rather than keeping a book that
  // is gone.
  await page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await archiveBook(page, bookName);
  await expect(page.getByRole("heading", { name: "Archived books", exact: true })).toBeVisible();
  await switchTab(page, "Stream");
  // 总账 renders no chip, so the dead scope is gone exactly when the chip is.
  await expect(page.getByTestId("book-scope-chip")).toHaveCount(0);

  // Leave the workspace as it was found: restore the book, then remove it.
  await page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await bookRow(page, bookName).getByRole("button", { name: "Restore", exact: true }).click();
  await bookRow(page, bookName).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(bookRow(page, bookName)).toHaveCount(0);

  expect(errors).toEqual([]);
});
