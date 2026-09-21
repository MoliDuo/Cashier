import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import pg from "pg";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { prepareTestPostgres } from "./prepare-test-postgres.mjs";
import { createDemoAiServer } from "./demo-ai-server.mjs";
import { createSmokeObjectStorage } from "./smoke-object-storage.mjs";

const adminUrl = new URL(
  process.env.TEST_DATABASE_URL ?? "postgresql://cashier:cashier@127.0.0.1:55432/cashier_test"
);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(adminUrl.hostname) ||
  adminUrl.pathname !== "/cashier_test"
) {
  throw new Error("Smoke tests require a loopback cashier_test database with CREATEDB permission.");
}
const postgres = await prepareTestPostgres();
adminUrl.href = postgres.databaseUrl;
const databaseName = `smoke_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const reservePort = async () => {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  if (typeof address !== "object" || address == null) throw new Error("Could not reserve port");
  await new Promise((resolve) => listener.close(resolve));
  return address.port;
};
const port = await reservePort();
const aiPort = await reservePort();
const storagePort = await reservePort();
const baseURL = `http://127.0.0.1:${port}`;
// The upload path is part of what production does, so the run points it at an
// in-memory S3 endpoint instead of a bucket: the image still travels through
// the real client, and nothing leaves this machine or outlives the run.
const storageEndpoint = `http://127.0.0.1:${storagePort}`;
const password = `Smoke9-${randomUUID()}`;
const userId = randomUUID();
const sharedLedgerId = randomUUID();
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: databaseUrl.toString(),
  APP_URL: baseURL,
  AUTH_URL: baseURL,
  AUTH_TRUST_HOST: "true",
  AUTH_SECRET: randomUUID(),
  API_KEY_PEPPER: randomUUID(),
  AUTH_OTP_PEPPER: randomUUID(),
  AUTH_RESEND_KEY: "",
  AUTH_EMAIL_FROM: "Cashier <noreply@example.com>",
  OPENAI_API_KEY: "smoke-unused",
  OPENAI_BASE_URL: `http://127.0.0.1:${aiPort}/v1`,
  AI_MAX_RETRIES: "0",
  S3_ENDPOINT: storageEndpoint,
  S3_PUBLIC_ENDPOINT: storageEndpoint,
  S3_BUCKET: "smoke-objects",
  S3_ACCESS_KEY_ID: "smoke-unused",
  S3_SECRET_ACCESS_KEY: "smoke-unused",
  S3_FORCE_PATH_STYLE: "true",
  DEV_AUTH_BYPASS: "false",
  TRUSTED_PROXY: "",
  TZ: "UTC",
  SMOKE_BASE_URL: baseURL,
  SMOKE_EMAIL: "smoke@example.com",
  SMOKE_PASSWORD: password,
};
let activeChild;
let server;
const aiServer = createDemoAiServer({ latencyMs: 3_000 });
aiServer.listen(aiPort, "127.0.0.1");
await once(aiServer, "listening");
const storageServer = createSmokeObjectStorage({ log: console.log });
storageServer.listen(storagePort, "127.0.0.1");
await once(storageServer, "listening");
let created = false;
let interrupted = false;
const run = async (args) => {
  if (interrupted) throw new Error("Smoke test interrupted");
  activeChild = spawn(process.execPath, args, { env, stdio: "inherit" });
  const [code] = await once(activeChild, "exit");
  activeChild = undefined;
  if (code !== 0) throw new Error(`Smoke subprocess failed (${code})`);
};
const stop = async (child) => {
  if (child == null || child.exitCode != null || child.signalCode != null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(timer);
};
const interrupt = () => {
  interrupted = true;
  activeChild?.kill("SIGTERM");
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
const admin = new pg.Client({ connectionString: adminUrl.toString() });
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const db = new pg.Client({ connectionString: databaseUrl.toString() });
  await db.connect();
  try {
    await db.query("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public");
    await migrate(drizzle(db), { migrationsFolder: "src/persistence/postgres-migrations" });
    const hash = await bcrypt.hash(password, 12);
    // One account with one login address and one ledger with two books: the
    // smoke suite signs in with the password, and a record written from 总账
    // lands in whichever book the writer picked (or the first one, 共同支出).
    await db.query(
      `INSERT INTO users (id, password_hash, password_updated_at, created_at, updated_at) VALUES ($1, $2, now(), now(), now())`,
      [userId, hash]
    );
    await db.query(
      `INSERT INTO login_emails (user_id, email, email_verified, created_at, updated_at) VALUES ($1, $2, now(), now(), now())`,
      [userId, env.SMOKE_EMAIL]
    );
    await db.query(
      `INSERT INTO ledgers (id, user_id, main_currency, created_at, updated_at) VALUES ($1, $2, 'CNY', now(), now())`,
      [sharedLedgerId, userId]
    );
    await db.query(
      `INSERT INTO books (ledger_id, name, sort_order, created_at, updated_at) VALUES ($1, '共同支出', 1, now(), now())`,
      [sharedLedgerId]
    );
    await db.query(
      `INSERT INTO books (ledger_id, name, sort_order, created_at, updated_at) VALUES ($1, '旅行支出', 2, now(), now())`,
      [sharedLedgerId]
    );
    for (const [index, name] of ["Food", "Shopping", "Travel"].entries()) {
      await db.query(
        `INSERT INTO entry_categories (ledger_id, name, sort_order, created_at, updated_at) VALUES ($1, $2, $3, now(), now())`,
        [sharedLedgerId, name, index + 1]
      );
    }
  } finally {
    await db.end();
  }
  await run(["node_modules/next/dist/bin/next", "build", "--webpack"]);
  await run(["scripts/check-protected-route-bundle.mjs"]);
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
    { env, stdio: "inherit" }
  );
  // The @demo spec needs the dev sign-in, which this runner deliberately keeps
  // off (DEV_AUTH_BYPASS is false and NODE_ENV is production). It runs under
  // `npm run test:demo`, which boots the demo environment instead.
  await run([
    "node_modules/@playwright/test/cli.js",
    "test",
    "--grep-invert",
    "@demo",
    ...process.argv.slice(2),
  ]);
} finally {
  await stop(activeChild);
  await stop(server);
  if (aiServer.listening) await new Promise((resolve) => aiServer.close(resolve));
  if (storageServer.listening) await new Promise((resolve) => storageServer.close(resolve));
  if (created && /^smoke_[a-f0-9]{32}$/.test(databaseName)) {
    const target = await admin.query("SELECT datname FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);
    if (target.rows.length === 1) {
      console.log(`[smoke] Removing this run's database: ${databaseName}`);
      await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    }
  }
  await admin.end();
  await postgres.cleanup();
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
