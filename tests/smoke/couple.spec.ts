import { expect, test } from "@playwright/test";
import { openMemberSwitch, selectMemberScope } from "./member-switch";

test("partners see the same record under their own logins", async ({ page }) => {
  await page.goto("/en/login");
  await page.getByLabel("Email Address", { exact: true }).fill(process.env.SMOKE_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.getByRole("button", { name: "New Record", exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByRole("button", { name: "Quick Entry", exact: true }).click();
  await create
    .getByRole("textbox", { name: "Item name (optional)", exact: true })
    .fill("Shared smoke entry");
  await create.getByRole("group").getByRole("button").first().click();
  await create.getByRole("textbox", { name: "Amount", exact: true }).fill("12.34");
  await create.getByRole("button", { name: "Record", exact: true }).click();
  await expect(create).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "Ledger navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.goto("/en/login");
  await page.getByLabel("Email Address", { exact: true }).fill(process.env.SMOKE_PARTNER_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText("Shared smoke entry", { exact: true }).first()).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Ledger navigation" });
  await navigation.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByText("Shared smoke entry", { exact: true }).first()).toBeVisible();
  // The partner wrote that entry, so narrowing the details to 我 hides it. The
  // switch sits above every browsing tab, so picking there is enough.
  await selectMemberScope(page, "mine");
  await expect(page.getByText("Shared smoke entry", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("member-scope-chip")).toContainText("Only");
  // Statistics has no toolbar to carry the chip, so the switch is the only
  // place a scope is visible there — and the pull still opens it.
  await navigation.getByRole("button", { name: "Stats", exact: true }).click();
  await openMemberSwitch(page);
  await expect(
    page.getByRole("group", { name: "Record scope" }).getByRole("button").first()
  ).toHaveAttribute("aria-pressed", "true");
  await selectMemberScope(page, "partner");
  await navigation.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByText("Shared smoke entry", { exact: true }).first()).toBeVisible();
});
