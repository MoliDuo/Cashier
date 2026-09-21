#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fixtureCredentialToken } from "./demo-data.mjs";

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

/** Builds the forced local environment for focused safety tests. */
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

/** Returns the standalone Compose invocation used by the demo stack. */
export function createDemoComposeArgs(environment = process.env) {
  return [...composeProjectArgs(environment), "up", "-d", "postgres", "minio", "storage-bootstrap"];
}

/**
 * The services a preview needs, which is only the database it reads: bringing up
 * MinIO and its bucket bootstrap would create the very objects a preview promises
 * not to touch.
 *
 * Returns the database-only Compose invocation the preview uses.
 */
export function createDemoPreviewComposeArgs(environment = process.env) {
  return [...composeProjectArgs(environment), "up", "-d", "postgres"];
}

function composeProjectArgs(environment) {
  const project = environment.CASHIER_DEMO_PROJECT ?? "cashier-demo";
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(project)) {
    throw new Error("CASHIER_DEMO_PROJECT must be a lowercase Compose project name");
  }
  return ["compose", "-p", project, "-f", "docker-compose.demo.yml"];
}

/** Returns the fixture command while preserving reset preview semantics. */
export function createDemoDataArgs({ reset = false, apply = false } = {}) {
  return ["scripts/demo-data.mjs", "reset", ...(!reset || apply ? ["--apply"] : [])];
}

/**
 * The tokens live only in the fixture: the database stores a hash and the
 * settings page shows just the prefix and suffix, so this banner is where a
 * developer copies them from.
 *
 * Lists the seeded sample credentials printed once the demo is up.
 */
export function formatDemoCredentialLines() {
  return [
    "[demo] Sample API keys (valid for this local demo only):",
    ...fixture.serviceCredentials.map((credential) => {
      // Each key writes to its own book, so the banner names the book rather
      // than a person: an upload through it lands there.
      const columns = `${credential.name.padEnd(24)} ${credential.book.padEnd(10)}`;
      return `  ${columns} ${fixtureCredentialToken(credential)}`;
    }),
    "[demo] Pass one as an Authorization: Bearer <token> header to /api/v1.",
  ];
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

/**
 * Runs the disposable demo stack up to the point where the app can start.
 *
 * `npm run demo:reset` is a question rather than a command: it has to say what
 * a rebuild would replace before anything has dropped a schema, migrated,
 * seeded or written to object storage. Only `--apply`, or a normal
 * `dev:demo`/`test:demo` launch, runs the destructive path.
 *
 * Exposes the demo command sequence to an injected executor.
 * @param {{ args?: string[], environment?: Record<string, string | undefined>, execute?: (command: string, args: string[], environment: Record<string, string | undefined>) => Promise<unknown> }} [options]
 */
export async function runDemoCommands({
  args = [],
  environment = process.env,
  execute = run,
} = {}) {
  const demoEnv = createDemoEnvironment(environment);
  const reset = args.includes("--reset");
  const apply = args.includes("--apply");
  if (reset && !apply) {
    await execute("docker", createDemoPreviewComposeArgs(demoEnv), demoEnv);
    await execute(process.execPath, ["scripts/demo-data.mjs", "preview-reset"], demoEnv);
    return { mode: "preview-reset", environment: demoEnv };
  }
  await execute("docker", createDemoComposeArgs(demoEnv), demoEnv);
  // The demo workspace is disposable and rebuilt from the fixture on every
  // launch, so its schema is dropped before migrating: a demo database left
  // over from an earlier release is not a database 0048 can migrate.
  await execute(process.execPath, ["scripts/demo-data.mjs", "reset-schema"], demoEnv);
  await execute(process.execPath, ["scripts/migrate-database.mjs"], demoEnv);
  await execute(process.execPath, createDemoDataArgs({ reset, apply }), demoEnv);
  return { mode: reset ? "reset" : "seed", environment: demoEnv };
}

async function main(args = process.argv.slice(2), environment = process.env) {
  const test = args.includes("--test");
  const { mode, environment: demoEnv } = await runDemoCommands({ args, environment });
  // A preview stops at its report, and a reset asked for by name stops once the
  // rebuild is done; only a normal launch goes on to start the app.
  if (mode !== "seed") return;

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
    console.log('[demo] Select "Continue as dev" to open the workspace.');
    for (const line of formatDemoCredentialLines()) console.log(line);
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
