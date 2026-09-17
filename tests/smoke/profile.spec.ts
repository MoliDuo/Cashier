import { expect, test } from "@playwright/test";
import { memberNickname, memberScopeOptions } from "./member-switch";

/**
 * The nickname is what the member switch is labelled from, so renaming yourself
 * has to change the strip without a reload: the two read the same query.
 */
test("renaming yourself in settings relabels the member switch", async ({ page }) => {
  const nickname = `A${Date.now() % 100000}`;
  await page.goto("/en/login");
  await page.getByLabel("Email Address", { exact: true }).fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();

  // Sections carry a heading rather than an aria-label, so the profile one is
  // found the way a reader would: by its title.
  const profile = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Profile", exact: true }) });
  await expect(profile).toBeVisible();
  // The partner's nickname is shown read-only, so which side of the switch is
  // which stays clear while only one row is editable.
  await expect(
    profile.getByRole("heading", { name: "Partner's nickname", exact: true })
  ).toBeVisible();

  const nicknameField = profile.getByRole("textbox", { name: "Nickname", exact: true });
  const original = await nicknameField.inputValue();
  await nicknameField.fill(nickname);
  await profile.getByRole("button", { name: "Save", exact: true }).click();
  await expect(nicknameField).toHaveValue(nickname);

  await page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name: "Stream", exact: true })
    .click();
  // The switch reads the same query the save invalidated, so the new name is
  // already there without a reload. This leaves the strip open.
  expect(await memberNickname(page, "mine")).toBe(nickname);
  await memberScopeOptions(page).first().click();
  await expect(page.getByTestId("member-scope-chip")).toContainText(nickname);

  // The suite shares one database across projects, so the rename goes back:
  // leaving it would change what the other specs read off the switch.
  await page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await nicknameField.fill(original);
  await profile.getByRole("button", { name: "Save", exact: true }).click();
  await expect(nicknameField).toHaveValue(original);
});
