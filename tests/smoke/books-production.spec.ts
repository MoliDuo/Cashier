import { expect, test, type Page } from "@playwright/test";
import { currentBookOption, openBookSwitcher, selectBook } from "./book-switch";

/**
 * The multi-book flows the production runner can actually exercise: a real
 * password sign-in, the two seeded books (共同支出 and 旅行支出), the settings tab
 * driven from a second, independent browser context, and a real upload through
 * the public API v1 with a book-bound service credential.
 *
 * Every project of this file runs against the same database, so nothing here
 * touches the seeded books and everything it creates it also retires. A book
 * that ever held a record can only be archived — a hard delete refuses it — so
 * those are left archived, while the empty ones are deleted outright.
 */

/** A 1x1 PNG: the smallest image the upload path accepts. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function apiBase(): string {
  const base = process.env.SMOKE_BASE_URL;
  if (base == null || base === "") throw new Error("SMOKE_BASE_URL is not set");
  return base;
}

/** Signs in with the account's real password; no development bypass exists here. */
async function login(page: Page) {
  await page.goto("/en");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email Address", { exact: true }).fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "New Record", exact: true })).toBeEnabled();
}

async function openTab(page: Page, name: "Stream" | "Details" | "Stats" | "Settings") {
  await page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name, exact: true })
    .click();
}

/** The 分账 row that names `name`, matched exactly so one book cannot shadow another. */
function bookRow(page: Page, name: string) {
  return page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
}

async function addBook(page: Page, name: string) {
  await page.getByRole("button", { name: "Add book", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Add book", exact: true }).click();
  await expect(bookRow(page, name)).toBeVisible();
}

async function deleteBook(page: Page, name: string) {
  await bookRow(page, name).getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(bookRow(page, name)).toHaveCount(0);
}

/**
 * Retires a book through the confirmation. Used where the book already holds a
 * record, which is the case a hard delete refuses and the case the demo
 * workspace's own tests are not allowed to produce.
 */
async function archiveBook(page: Page, name: string) {
  await bookRow(page, name).getByRole("button", { name: "Archive", exact: true }).click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await expect(bookRow(page, name).getByRole("button", { name: "Restore" })).toBeVisible();
}

/** The pull-down switcher, picking by name so a leftover book cannot shift the pick. */
async function selectBookByName(page: Page, name: string) {
  await openBookSwitcher(page);
  // By accessible name, not `hasText`: that comparison ignores case, so a book
  // named Eta would otherwise also find Theta and the click would be ambiguous.
  await page
    .getByRole("group", { name: "Book" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.getByTestId("book-reveal")).toHaveAttribute("data-pull-reveal", "closed");
  await expect(currentBookOption(page)).toHaveText(name);
}

/** Opens 记一笔, files one quick entry into `book`, and waits for it to be gone. */
async function recordQuickEntry(
  page: Page,
  { item, amount, book }: { item: string; amount: string; book: string }
) {
  await page.getByRole("button", { name: "New Record", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByRole("button", { name: "Quick Entry", exact: true }).click();
  const picker = dialog.getByLabel("Book", { exact: true });
  await picker.press("ArrowDown");
  await page.getByRole("option", { name: book, exact: true }).click();
  await dialog.getByRole("textbox", { name: "Item name (optional)", exact: true }).fill(item);
  await dialog.getByRole("group").getByRole("button").first().click();
  await dialog.getByRole("textbox", { name: "Amount", exact: true }).fill(amount);
  await dialog.getByRole("button", { name: "Record", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(item, { exact: true }).first()).toBeVisible();
}

/** The stream's total for the settled period, read off its own toolbar. */
function streamTotal(page: Page) {
  return page.getByTestId("entries-toolbar").first();
}

function statsHero(page: Page) {
  return page.getByText("Total Expense", { exact: true }).locator("..");
}

/** A second browser, with its own cookies: the device state must not travel. */
async function newDevice(page: Page) {
  const context = await page.context().browser()!.newContext();
  const other = await context.newPage();
  await login(other);
  return { context, page: other };
}

test("books production creates, renames and reorders a book, and keeps it across a reload", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = testInfo.project.name;
  const firstName = `Alpha ${suffix}`;
  const secondName = `Beta ${suffix}`;
  const renamed = `Beta2 ${suffix}`;

  /** The watched rows, in the order the list actually paints them. */
  const order = async (names: [string, string]) => {
    const texts = await page.getByRole("listitem").allTextContents();
    return names
      .map((name) => ({ name, at: texts.findIndex((text) => text.includes(name)) }))
      .filter((row) => row.at >= 0)
      .sort((left, right) => left.at - right.at)
      .map((row) => row.name);
  };

  await login(page);
  await openTab(page, "Settings");
  await addBook(page, firstName);
  await addBook(page, secondName);
  await expect.poll(() => order([firstName, secondName])).toEqual([firstName, secondName]);

  // A name is one field of a book that already exists, so the row opens in place
  // and Enter writes it — nothing covers the list to rename it.
  await bookRow(page, secondName)
    .getByRole("button", { name: `Rename ${secondName}`, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const nameInput = page.getByRole("textbox", { name: `Rename ${secondName}`, exact: true });
  await nameInput.fill(renamed);
  await nameInput.press("Enter");
  await expect(bookRow(page, renamed)).toBeVisible();
  await expect(bookRow(page, secondName)).toHaveCount(0);

  // One step up, not to the top: the seeded books keep the positions every
  // other test in this runner depends on.
  await bookRow(page, renamed)
    .getByRole("button", { name: `Move ${renamed} up`, exact: true })
    .click();
  // 分账 is written from the action's answer, so the swap lands a round trip after
  // the click; the painted order is the state to wait on.
  await expect.poll(() => order([firstName, renamed])).toEqual([renamed, firstName]);
  await expect(
    bookRow(page, renamed).getByRole("button", { name: `Move ${renamed} up`, exact: true })
  ).toBeEnabled();

  await page.reload();
  await expect(bookRow(page, renamed)).toBeVisible();
  await expect.poll(() => order([firstName, renamed])).toEqual([renamed, firstName]);

  await deleteBook(page, renamed);
  await deleteBook(page, firstName);
  expect(errors).toEqual([]);
});

test("books production scopes the stream, the details and the stats to one book", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = testInfo.project.name;
  const bookA = `Gamma ${suffix}`;
  const bookB = `Delta ${suffix}`;
  const itemA = `Gamma item ${suffix}`;
  const itemB = `Delta item ${suffix}`;

  await login(page);
  await openTab(page, "Settings");
  await addBook(page, bookA);
  await addBook(page, bookB);
  await openTab(page, "Stream");

  await recordQuickEntry(page, { item: itemA, amount: "111.11", book: bookA });
  await recordQuickEntry(page, { item: itemB, amount: "222.22", book: bookB });

  // 总账 is every book at once.
  await expect(page.getByText(itemA, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(itemB, { exact: true }).first()).toBeVisible();

  await selectBookByName(page, bookA);
  await expect(page.getByText(itemA, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(itemB, { exact: true })).toHaveCount(0);
  await expect(streamTotal(page)).toContainText("¥111.11");

  await selectBookByName(page, bookB);
  await expect(page.getByText(itemB, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(itemA, { exact: true })).toHaveCount(0);
  await expect(streamTotal(page)).toContainText("¥222.22");

  // 明细 follows the same scope, and the same scope carries across tabs.
  await openTab(page, "Details");
  await expect(page.getByTestId("ledger-entry-card-root").filter({ hasText: itemB })).toHaveCount(
    1
  );
  await expect(page.getByTestId("ledger-entry-card-root").filter({ hasText: itemA })).toHaveCount(
    0
  );
  await selectBook(page, "all");
  await expect(page.getByTestId("ledger-entry-card-root").filter({ hasText: itemA })).toHaveCount(
    1
  );
  await expect(page.getByTestId("ledger-entry-card-root").filter({ hasText: itemB })).toHaveCount(
    1
  );

  await selectBookByName(page, bookA);
  await openTab(page, "Stats");
  // The hero is the scope's own total, so a wrong scope cannot pass by summing
  // the books to the same number.
  await expect(statsHero(page).getByText("¥111.11", { exact: true })).toBeVisible();

  await selectBookByName(page, bookB);
  await expect(statsHero(page).getByText("¥222.22", { exact: true })).toBeVisible();

  await openTab(page, "Settings");
  await archiveBook(page, bookA);
  await archiveBook(page, bookB);
  expect(errors).toEqual([]);
});

test("books production moves a record from one book to another", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = testInfo.project.name;
  const bookA = `Epsilon ${suffix}`;
  const bookB = `Zeta ${suffix}`;
  const item = `Moved item ${suffix}`;

  await login(page);
  await openTab(page, "Settings");
  await addBook(page, bookA);
  await addBook(page, bookB);
  await openTab(page, "Stream");
  await recordQuickEntry(page, { item, amount: "333.33", book: bookA });

  await selectBookByName(page, bookA);
  await expect(streamTotal(page)).toContainText("¥333.33");

  // The record's own page owns the move; the book that gets it is the one that
  // then counts it, in the book view and in the total.
  await page
    .getByTestId("source-document-card-root")
    .filter({ hasText: item })
    .getByRole("button", { name: item, exact: true })
    .click();
  const detail = page.getByRole("dialog").first();
  const detailBook = detail.getByLabel("Book", { exact: true });
  await expect(detailBook).toContainText(bookA);
  await detailBook.press("ArrowDown");
  await page.getByRole("option", { name: bookB, exact: true }).click();
  await expect(detailBook).toContainText(bookB);
  await detail.getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.getByText(item, { exact: true })).toHaveCount(0);
  await selectBookByName(page, bookB);
  await expect(page.getByText(item, { exact: true }).first()).toBeVisible();
  await expect(streamTotal(page)).toContainText("¥333.33");

  await selectBookByName(page, bookA);
  await expect(streamTotal(page)).toContainText("¥0.00");
  await openTab(page, "Stats");
  await expect(statsHero(page).getByText("¥0.00", { exact: true })).toBeVisible();
  await selectBookByName(page, bookB);
  await expect(statsHero(page).getByText("¥333.33", { exact: true })).toBeVisible();

  await openTab(page, "Settings");
  await archiveBook(page, bookA);
  await archiveBook(page, bookB);
  expect(errors).toEqual([]);
});

test("books production keeps the viewed book and the record picker apart", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = testInfo.project.name;
  const bookA = `Eta ${suffix}`;
  const bookB = `Theta ${suffix}`;
  const item = `Picker item ${suffix}`;

  await login(page);
  await openTab(page, "Settings");
  await addBook(page, bookA);
  await addBook(page, bookB);
  await openTab(page, "Stream");
  await selectBookByName(page, bookA);

  // The view is 甲账, but 记一笔 starts from its own memory — the first book in
  // 设置 order — because the two choices are answers to different questions.
  await page.getByRole("button", { name: "New Record", exact: true }).click();
  let dialog = page.getByRole("dialog").last();
  await dialog.getByRole("button", { name: "Quick Entry", exact: true }).click();
  await expect(dialog.getByLabel("Book", { exact: true })).toContainText("共同支出");

  await dialog.getByLabel("Book", { exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: bookB, exact: true }).click();
  await dialog.getByRole("textbox", { name: "Item name (optional)", exact: true }).fill(item);
  await dialog.getByRole("group").getByRole("button").first().click();
  await dialog.getByRole("textbox", { name: "Amount", exact: true }).fill("44.44");
  await dialog.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByText(`Saved to ${bookB}. It is not visible in the current view.`, { exact: true })
  ).toBeVisible();

  // Saving elsewhere changed the picker's memory, not what is being viewed.
  await expect(currentBookOption(page)).toHaveText(bookA);
  await expect(page.getByText(item, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "New Record", exact: true }).click();
  dialog = page.getByRole("dialog").last();
  await expect(dialog.getByLabel("Book", { exact: true })).toContainText(bookB);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await selectBookByName(page, bookB);
  await expect(page.getByText(item, { exact: true }).first()).toBeVisible();

  await openTab(page, "Settings");
  await archiveBook(page, bookA);
  await archiveBook(page, bookB);
  expect(errors).toEqual([]);
});

test("books production keeps the viewed book per browser, not per account", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await login(page);
  await expect(currentBookOption(page)).toHaveText("All books");
  await selectBookByName(page, "旅行支出");

  await page.reload();
  await expect(currentBookOption(page)).toHaveText("旅行支出");

  // Another browser signs in as the same account and still opens on 总账.
  const other = await newDevice(page);
  try {
    await expect(currentBookOption(other.page)).toHaveText("All books");
    await selectBookByName(other.page, "共同支出");
    await page.reload();
    await expect(currentBookOption(page)).toHaveText("旅行支出");
  } finally {
    await other.context.close();
  }
  expect(errors).toEqual([]);
});

test("books production sees a book archived by another browser when 设置 opens", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const bookName = `Iota ${testInfo.project.name}`;

  await login(page);
  const other = await newDevice(page);
  try {
    await openTab(other.page, "Settings");
    await addBook(other.page, bookName);
    await archiveBook(other.page, bookName);

    // This browser has not read 分账 yet, so this first visit is what has to
    // carry the archived row — the workspace bootstrap only knows live books.
    await openTab(page, "Settings");
    await expect(page.getByRole("heading", { name: "Archived books", exact: true })).toBeVisible();
    await expect(bookRow(page, bookName).getByText("Archived", { exact: true })).toBeVisible();
    await bookRow(page, bookName).getByRole("button", { name: "Restore", exact: true }).click();
    await expect(bookRow(page, bookName).getByRole("button", { name: "Archive" })).toBeVisible();
    await deleteBook(page, bookName);
  } finally {
    await other.context.close();
  }
  expect(errors).toEqual([]);
});

test("books production refreshes 设置 to pick up another browser's change", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const bookName = `Kappa ${testInfo.project.name}`;

  await login(page);
  await openTab(page, "Settings");
  await expect(bookRow(page, "共同支出")).toBeVisible();

  const other = await newDevice(page);
  try {
    await openTab(other.page, "Settings");
    await addBook(other.page, bookName);

    // The list this browser already holds is fresh, so only the manual refresh
    // can bring the other browser's book in — and 设置 refreshes by tapping the
    // destination this browser is already on.
    await expect(bookRow(page, bookName)).toHaveCount(0);
    await openTab(page, "Settings");
    await expect(bookRow(page, bookName)).toBeVisible();
    await deleteBook(page, bookName);
    await expect(bookRow(other.page, bookName)).toHaveCount(1);
  } finally {
    await other.context.close();
  }
  expect(errors).toEqual([]);
});

test("books production falls back to 总账 when the viewed book is archived", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const bookName = `Lambda ${testInfo.project.name}`;

  await login(page);
  await openTab(page, "Settings");
  await addBook(page, bookName);
  await openTab(page, "Stream");
  await selectBookByName(page, bookName);

  await openTab(page, "Settings");
  await archiveBook(page, bookName);
  await openTab(page, "Stream");
  // The dead scope is gone once the strip marks 总账 again.
  await expect(currentBookOption(page)).toHaveText("All books");

  await openTab(page, "Settings");
  await bookRow(page, bookName).getByRole("button", { name: "Restore", exact: true }).click();
  await expect(bookRow(page, bookName).getByRole("button", { name: "Archive" })).toBeVisible();
  await deleteBook(page, bookName);
  expect(errors).toEqual([]);
});

test("books production files an API upload into the book its key is bound to", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = testInfo.project.name;
  const bookName = `Mu ${suffix}`;
  const credentialName = `Uploader ${suffix}`;

  await login(page);
  await openTab(page, "Settings");
  await addBook(page, bookName);

  await page.getByRole("button", { name: "New Credential", exact: true }).click();
  const createDialog = page.getByRole("dialog").last();
  await createDialog
    .getByLabel("Credential name (e.g., automatic notes script)", { exact: true })
    .fill(credentialName);
  await createDialog.getByLabel("Book", { exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: bookName, exact: true }).click();
  await createDialog.getByRole("button", { name: "Confirm", exact: true }).click();

  const tokenDialog = page.getByRole("dialog").last();
  const tokenMatch = (await tokenDialog.locator("div.break-all").innerText()).match(
    /sk_live_[0-9a-f]{48}/
  );
  const token = tokenMatch?.[0];
  expect(token).toBeTruthy();
  await tokenDialog.getByRole("button", { name: "I've saved it", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: `Change the book for ${credentialName}`, exact: true })
  ).toHaveText(bookName);

  const headers = { Authorization: `Bearer ${token!}` };
  const created = await page.request.post(`${apiBase()}/api/v1/source-documents`, {
    headers,
    data: { images: [{ data: PNG_BASE64, mimeType: "image/png" }] },
  });
  expect(created.status()).toBe(201);
  const createdBody = (await created.json()) as { sourceDocumentId?: string };
  const sourceDocumentId = createdBody.sourceDocumentId;
  expect(sourceDocumentId).toBeTruthy();

  // The stub provider answers in seconds; polling the status is the observable
  // state, so nothing here waits on a fixed clock.
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${apiBase()}/api/v1/source-documents/${sourceDocumentId}`,
          { headers }
        );
        const body = (await response.json()) as { status?: string };
        return body.status ?? `http-${response.status()}`;
      },
      { timeout: 60_000, intervals: [1_000, 2_000] }
    )
    .toBe("completed");

  await openTab(page, "Stream");
  await selectBookByName(page, bookName);
  await streamTotal(page).click();
  await expect(
    page.getByTestId("source-document-card-root").filter({ hasText: "Demo Receipt" })
  ).toHaveCount(1);
  await expect(streamTotal(page)).toContainText("¥12.34");

  // Take the record back out — through its own detail page — so the key can be
  // deleted and the book retired without leaning on a hard delete it refuses.
  await page
    .getByTestId("source-document-card-root")
    .filter({ hasText: "Demo Receipt" })
    .getByRole("button", { name: "Demo Receipt", exact: true })
    .click();
  const detail = page.getByRole("dialog").first();
  await detail.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openTab(page, "Settings");
  await page.getByRole("button", { name: `Delete ${credentialName}`, exact: true }).click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("button", { name: `Delete ${credentialName}` })).toHaveCount(0);
  await archiveBook(page, bookName);
  expect(errors).toEqual([]);
});
