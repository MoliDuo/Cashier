#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_PORTS = { app: 3000, postgres: 55433, s3: 59000 };
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/demo-workspace.json", import.meta.url))
);

function integerPort(name, value, fallback) {
  const parsed = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

/** @testOnly Builds the forced local environment for focused safety tests. */
export function createDemoEnvironment(environment = process.env) {
  const appPort = integerPort(
    "CASHIER_DEMO_APP_PORT",
    environment.CASHIER_DEMO_APP_PORT,
    DEFAULT_PORTS.app
  );
  const postgresPort = integerPort(
    "CASHIER_DEMO_POSTGRES_PORT",
    environment.CASHIER_DEMO_POSTGRES_PORT,
    DEFAULT_PORTS.postgres
  );
  const s3Port = integerPort(
    "CASHIER_DEMO_S3_PORT",
    environment.CASHIER_DEMO_S3_PORT,
    DEFAULT_PORTS.s3
  );
  const appUrl = `http://127.0.0.1:${appPort}`;
  return {
    ...environment,
    NODE_ENV: "development",
    CASHIER_DEMO_MODE: "true",
    DATABASE_URL: `postgresql://cashier:cashier-local-only@127.0.0.1:${postgresPort}/cashier_demo`,
    APP_URL: appUrl,
    AUTH_URL: appUrl,
    AUTH_TRUST_HOST: "true",
    AUTH_SECRET: "cashier-demo-only-auth-secret",
    API_KEY_PEPPER: "cashier-demo-only-api-key-pepper",
    RATE_LIMIT_PEPPER: "cashier-demo-only-rate-limit-pepper",
    AUTH_OTP_PEPPER: "cashier-demo-only-auth-otp-pepper",
    AUTH_RESEND_KEY: "",
    OPENAI_API_KEY: "demo-unused",
    OPENAI_BASE_URL: "http://127.0.0.1:1/v1",
    AI_MAX_RETRIES: "0",
    S3_ENDPOINT: `http://127.0.0.1:${s3Port}`,
    S3_PUBLIC_ENDPOINT: `http://127.0.0.1:${s3Port}`,
    S3_REGION: "auto",
    S3_BUCKET: "cashier",
    S3_ACCESS_KEY_ID: "cashier",
    S3_SECRET_ACCESS_KEY: "cashier-local-only-secret",
    S3_FORCE_PATH_STYLE: "true",
    DEV_AUTH_BYPASS: "true",
    COUPLE_OWNER_USER_ID: fixture.user.id,
    COUPLE_PARTNER_USER_ID: fixture.partner.id,
    COUPLE_LEDGER_ID: fixture.ledger.id,
    TRUSTED_PROXY: "",
    TZ: "UTC",
    CASHIER_DEMO_APP_PORT: String(appPort),
    CASHIER_DEMO_POSTGRES_PORT: String(postgresPort),
    CASHIER_DEMO_S3_PORT: String(s3Port),
  };
}

async function run(command, args, environment) {
  const child = spawn(command, args, { env: environment, stdio: "inherit" });
  const [code, signal] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(`${command} failed (${signal ?? code})`);
  }
}

/** @testOnly Returns the standalone Compose invocation used by the demo stack. */
export function createDemoComposeArgs(environment = process.env) {
  const project = environment.CASHIER_DEMO_PROJECT ?? "cashier-demo";
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(project)) {
    throw new Error("CASHIER_DEMO_PROJECT must be a lowercase Compose project name");
  }
  return [
    "compose",
    "-p",
    project,
    "-f",
    "docker-compose.demo.yml",
    "up",
    "-d",
    "postgres",
    "minio",
    "storage-bootstrap",
  ];
}

/** @testOnly Returns the fixture command while preserving reset preview semantics. */
export function createDemoDataArgs({ reset = false, apply = false } = {}) {
  return ["scripts/demo-data.mjs", "reset", ...(!reset || apply ? ["--apply"] : [])];
}

async function isPortAvailable(port) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    return true;
  } catch (error) {
    if (error?.code === "EADDRINUSE") return false;
    throw error;
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

async function waitForApp(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error("Next.js exited before the demo became ready");
    }
    try {
      const response = await fetch(`${url}/en/login`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Demo server did not become ready within 60 seconds");
}

async function stop(child) {
  if (child == null || child.exitCode != null || child.signalCode != null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(timeout);
}

async function main(args = process.argv.slice(2), environment = process.env) {
  const demoEnv = createDemoEnvironment(environment);
  const reset = args.includes("--reset");
  const apply = args.includes("--apply");
  const test = args.includes("--test");
  await run("docker", createDemoComposeArgs(demoEnv), demoEnv);
  await run(process.execPath, ["scripts/migrate-database.mjs"], demoEnv);
  await run(process.execPath, createDemoDataArgs({ reset, apply }), demoEnv);
  if (reset) return;

  const appPort = Number(demoEnv.CASHIER_DEMO_APP_PORT);
  if (!(await isPortAvailable(appPort))) {
    throw new Error(`Port ${appPort} is in use; set CASHIER_DEMO_APP_PORT to another local port`);
  }
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(appPort)],
    { env: demoEnv, stdio: "inherit" }
  );
  const interrupt = () => server.kill("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await waitForApp(demoEnv.APP_URL, server);
    console.log(`[demo] Ready: ${demoEnv.APP_URL}/en/login`);
    console.log('[demo] Select "Continue as dev" to open the seeded workspace.');
    if (test) {
      await run(
        process.execPath,
        ["node_modules/@playwright/test/cli.js", "test", "--grep", "@demo"],
        { ...demoEnv, SMOKE_BASE_URL: demoEnv.APP_URL }
      );
    } else {
      const [code] = await once(server, "exit");
      if (code !== 0 && code != null) throw new Error(`Next.js exited (${code})`);
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await stop(server);
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[demo] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
