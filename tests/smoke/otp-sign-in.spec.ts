import { expect, test, type Page } from "@playwright/test";

/** The code the smoke run's email outbox last received for `email`. */
async function latestCode(email: string): Promise<string> {
  const outbox = process.env.SMOKE_EMAIL_OUTBOX_URL;
  if (outbox == null || outbox === "") throw new Error("SMOKE_EMAIL_OUTBOX_URL is not set");
  let code: string | null = null;
  await expect
    .poll(async () => {
      const response = await fetch(`${outbox}/outbox?to=${encodeURIComponent(email)}`);
      code = response.ok
        ? (((await response.json()) as { code: string | null }).code ?? null)
        : null;
      return code;
    })
    .toMatch(/^\d{6}$/);
  return code!;
}

async function enterCode(page: Page, code: string) {
  for (const [index, digit] of [...code].entries()) {
    await page.getByLabel(`第 ${index + 1} 位，共 6 位`, { exact: true }).fill(digit);
  }
  await page.getByRole("button", { name: "验证", exact: true }).click();
}

test("an emailed code signs in, and a wrong one is refused", async ({ page }, testInfo) => {
  // An address gets one code a minute, and every project signs in as the same
  // account, so one project drives the screen; the rest reuse `signIn`.
  test.skip(testInfo.project.name !== "desktop", "one code per address per minute");
  const email = process.env.SMOKE_EMAIL!;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/login?callbackUrl=%2Fsettings");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await expect(page.getByText(`输入发送至 ${email} 的 6 位验证码`)).toBeVisible();
  const code = await latestCode(email);

  await enterCode(page, code === "000000" ? "111111" : "000000");
  await expect(page.getByRole("alert").filter({ hasText: "验证码无效" })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await enterCode(page, code);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
