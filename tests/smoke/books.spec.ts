import { expect, test } from "@playwright/test";
import { selectBook } from "./book-switch";

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
