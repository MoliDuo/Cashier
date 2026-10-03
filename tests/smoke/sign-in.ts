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
 * Signs the smoke address in by opening a session for it directly.
 *
 * A production build compiles `NODE_ENV` in as "production", so the dev
 * sign-in is off here however the server is started. The runner owns the
 * database and AUTH_SECRET, so it writes the session row a real sign-in would
 * and hands the browser the cookie; the OIDC spec is what drives the sign-in
 * through the provider.
 */
export async function signIn(page: Page): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const client = new pg.Client({ connectionString: requiredEnv("DATABASE_URL") });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO sessions (token_hash, email, created_at, expires_at, last_seen_at)
       VALUES ($1, $2, now(), now() + interval '1 day', now())`,
      [sessionTokenHash(token), requiredEnv("SMOKE_EMAIL")]
    );
  } finally {
    await client.end();
  }
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: token,
      domain: new URL(requiredEnv("SMOKE_BASE_URL")).hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login/);
}
