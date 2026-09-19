import { expect, type Page } from "@playwright/test";

/**
 * How the book switcher is reached without a pointer: a touch drag on a phone
 * and an upward wheel at the top of the page on a desktop. The strip is hidden
 * otherwise, so every smoke test that narrows the records has to make the same
 * gesture the user would.
 */
export type BookOption = "all" | number;

/** One pull: a touch drag on a phone, an upward wheel on a desktop. */
async function pull(page: Page) {
  const width = page.viewportSize()?.width ?? 0;
  if (width < 768) {
    // Playwright has no touch-drag API, so the gesture goes through the same
    // CDP channel its touchscreen.tap uses.
    const cdp = await page.context().newCDPSession(page);
    try {
      const x = Math.round(width / 2);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: 420 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: 480 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: 560 }],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally {
      await cdp.detach();
    }
  } else {
    await page.mouse.move(200, 200);
    await page.mouse.wheel(0, -200);
  }
}

/**
 * Drags or wheels the page down at its top, then waits for the strip. A dialog
 * that is still leaving owns the page — it keeps the strip `inert` and takes
 * the gesture — so the pull waits for the page first and repeats once if the
 * first one landed on the way out.
 */
export async function openBookSwitcher(page: Page) {
  const strip = page.getByTestId("book-reveal");
  const pullIfClosed = async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await pull(page);
  };

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await pullIfClosed();
  if ((await strip.getAttribute("data-pull-reveal")) !== "open") {
    await page.waitForTimeout(300);
    await pullIfClosed();
  }
  await expect(strip).toHaveAttribute("data-pull-reveal", "open");
}

/**
 * The strip's options, in the order it paints them: 总账 first, then the books.
 */
export function bookOptions(page: Page) {
  return page.getByRole("group", { name: "Book" }).getByRole("button").filter({ visible: true });
}

/**
 * The option the strip marks as the scope the view is showing. The strip stays
 * mounted while it is closed, so this reads the scope without reopening it.
 */
export function currentBookOption(page: Page) {
  return page.locator('[data-testid="book-reveal"] button[aria-pressed="true"]');
}

/**
 * Opens the strip and picks an option: 总账 by name, or the nth book by
 * position. Position rather than label, because book names are editable and
 * another test may already have renamed one.
 */
export async function selectBook(page: Page, option: BookOption) {
  await openBookSwitcher(page);
  const options = bookOptions(page);
  if (option === "all") await options.first().click();
  else await options.nth(option + 1).click();
  await expect(page.getByTestId("book-reveal")).toHaveAttribute("data-pull-reveal", "closed");
}
