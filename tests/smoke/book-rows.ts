import type { Page } from "@playwright/test";

/**
 * The 分账 row that names `name`, matched exactly so one book cannot shadow
 * another that starts the same.
 */
export function bookRow(page: Page, name: string) {
  return page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
}

/** A live book's ⋮ menu; archived rows offer 恢复 instead. */
export function bookMenu(page: Page, name: string) {
  return bookRow(page, name).getByRole("button", { name: `${name}的更多操作`, exact: true });
}

/** Opens a live book's ⋮ menu and picks one of its actions. */
export async function bookAction(
  page: Page,
  name: string,
  action: "上移" | "下移" | "归档" | "删除"
) {
  await bookMenu(page, name).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
