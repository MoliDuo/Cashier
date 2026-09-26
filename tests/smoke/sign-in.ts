import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { SESSION_COOKIE_NAME } from "../../src/modules/auth/constants";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value === "") throw new Error(`${name} is not set`);
  return value;
}

/**
 * The digest `sessions.token_hash` holds: HMAC-SHA-256 under the key
 * `deriveKey("session")` in src/lib/security/keys.ts derives from AUTH_SECRET.
 */
function sessionTokenHash(token: string): string {
  const key = Buffer.from(
    hkdfSync("sha256", requiredEnv("AUTH_SECRET"), "", "cashier:session", 32)
  );
  return createHmac("sha256", key).update(token).digest("hex");
}

/**
 * Signs the smoke account in by opening a session for it directly.
 *
 * A production build compiles `NODE_ENV` in as "production", so the dev
 * sign-in is off here however the server is started, and passkeys and email
 * codes are what the account has. The runner owns the database and
 * AUTH_SECRET, so it writes the session row a real sign-in would and hands the
 * browser the cookie; the email-code spec is what drives the sign-in screen.
 */
export async function signIn(page: Page): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const client = new pg.Client({ connectionString: requiredEnv("DATABASE_URL") });
  await client.connect();
  try {
    const inserted = await client.query(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, authenticated_at)
       SELECT $1, user_id, now(), now() + interval '1 day', now(), now()
       FROM login_emails WHERE lower(email) = lower($2)`,
      [sessionTokenHash(token), requiredEnv("SMOKE_EMAIL")]
    );
    if (inserted.rowCount !== 1) throw new Error("The smoke account's login email is not seeded");
  } finally {
    await client.end();
  }
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: token,
      url: requiredEnv("SMOKE_BASE_URL"),
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login/);
}
