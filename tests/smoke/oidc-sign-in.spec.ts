import { expect, test } from "@playwright/test";

/** Says who the smoke run's identity provider has signed in; `null` is nobody. */
async function providerSignsIn(email: string | null) {
  const provider = process.env.SMOKE_OIDC_URL;
  if (provider == null || provider === "") throw new Error("SMOKE_OIDC_URL is not set");
  const response = await fetch(`${provider}/__sign-in-as`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(email == null ? null : { email }),
  });
  expect(response.ok).toBe(true);
}

test.describe("sign-in through the identity provider", () => {
  // The provider holds one signed-in user for the whole run, so one project drives it.
  test.skip(({ isMobile }) => isMobile, "one provider user at a time");
  test.afterEach(() => providerSignsIn(null));

  test("opening a page signs a bound address in with no click, and signing out stays out", async ({
    page,
  }) => {
    await providerSignsIn(process.env.SMOKE_EMAIL!);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login|\/api\/auth/);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "退出登录", exact: true }).click();

    // Signed out here, still signed in at the provider: nothing sends the browser back.
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole("status").filter({ hasText: "已退出登录" })).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/login(\?|$)/);

    await page.getByRole("link", { name: "重新登录", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("an address nobody bound stops at the error page and does not loop", async ({ page }) => {
    await providerSignsIn("stranger@example.com");

    await page.goto("/");

    await expect(page).toHaveURL(/\/login\?error=not_bound$/);
    await expect(page.getByRole("alert").filter({ hasText: "这个账号还没有绑定" })).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/login\?error=not_bound$/);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a refusal at the provider stops at the error page", async ({ page }) => {
    await providerSignsIn(null);

    await page.goto("/");

    await expect(page).toHaveURL(/\/login\?error=denied$/);
    await expect(page.getByRole("alert").filter({ hasText: "登录已取消" })).toBeVisible();
  });
});
