import { expect, type Page } from "@playwright/test";

/**
 * How the member switch is reached without a pointer: a touch drag on a phone
 * and an upward wheel at the top of the page on a desktop. The strip is hidden
 * otherwise, so every smoke test that narrows the records has to make the same
 * gesture the user would.
 */
export type MemberOption = "mine" | "partner" | "all";

const OPTION_INDEX: Record<MemberOption, number> = { mine: 0, partner: 1, all: 2 };

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
export async function openMemberSwitch(page: Page) {
  const strip = page.getByTestId("member-scope-reveal");
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
 * Opens the strip without picking. Once a scope is set the toolbar chip is the
 * reliable way back in; on a fresh page the pull is what reveals it.
 */
export async function openMemberScope(page: Page) {
  const chip = page.getByTestId("member-scope-chip");
  if ((await chip.count()) > 0) await chip.click();
  else await openMemberSwitch(page);
}

/** The three options, in the order the strip paints them. */
export function memberScopeOptions(page: Page) {
  return page
    .getByRole("group", { name: "Record scope" })
    .getByRole("button")
    .filter({ visible: true });
}

/**
 * Opens the strip and picks an option by position: 我, 对方, 全部. Position
 * rather than label, because the two nicknames are editable and another test
 * may already have renamed one.
 */
export async function selectMemberScope(page: Page, option: MemberOption) {
  await openMemberScope(page);
  await memberScopeOptions(page).nth(OPTION_INDEX[option]).click();
  await expect(page.getByTestId("member-scope-reveal")).toHaveAttribute(
    "data-pull-reveal",
    "closed"
  );
}

/** The nickname the strip currently shows for one of the two people. */
export async function memberNickname(page: Page, option: "mine" | "partner") {
  await openMemberScope(page);
  const label = await memberScopeOptions(page).nth(OPTION_INDEX[option]).innerText();
  // 我 is labelled "<nickname> (Me)"; 对方 carries the bare nickname.
  return option === "mine" ? label.replace(/\s*\(Me\)$/, "") : label;
}
