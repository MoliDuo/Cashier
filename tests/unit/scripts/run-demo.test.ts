import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixtureCredentialToken } from "../../../scripts/demo-data";
import {
  createDemoComposeArgs,
  createDemoDataArgs,
  createDemoEnvironment,
  createDemoPreviewComposeArgs,
  formatDemoCredentialLines,
  runDemoCommands,
} from "../../../scripts/run-demo";

/** How a repository script runs: through tsx, under the react-server condition. */
const TSX = ["--conditions=react-server", "--import", "tsx"];

const fixture = JSON.parse(
  readFileSync(new URL("../../../scripts/fixtures/demo-workspace.json", import.meta.url), "utf8")
);

describe("demo runtime environment", () => {
  it("uses the standalone Compose file that does not require a project .env", () => {
    expect(createDemoComposeArgs()).toEqual([
      "compose",
      "-p",
      "cashier-demo",
      "-f",
      "docker-compose.demo.yml",
      "up",
      "-d",
      "postgres",
      "minio",
      "storage-bootstrap",
    ]);
  });

  it("brings up only the database a preview reads", () => {
    expect(createDemoPreviewComposeArgs()).toEqual([
      "compose",
      "-p",
      "cashier-demo",
      "-f",
      "docker-compose.demo.yml",
      "up",
      "-d",
      "postgres",
    ]);
  });

  it("rebuilds fixture data on each demo launch but keeps reset preview-only by default", () => {
    expect(createDemoDataArgs()).toEqual([...TSX, "scripts/demo-data.ts", "reset", "--apply"]);
    expect(createDemoDataArgs({ reset: true })).toEqual([...TSX, "scripts/demo-data.ts", "reset"]);
    expect(createDemoDataArgs({ reset: true, apply: true })).toEqual([
      ...TSX,
      "scripts/demo-data.ts",
      "reset",
      "--apply",
    ]);
  });

  it("overrides external service configuration with isolated loopback values", () => {
    const result = createDemoEnvironment({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://remote.example.com/production",
      S3_ENDPOINT: "https://storage.example.com",
      OPENAI_API_KEY: "real-key",
    });

    expect(result).toMatchObject({
      CASHIER_DEMO_MODE: "true",
      DATABASE_URL: "postgresql://cashier:cashier-local-only@127.0.0.1:55433/cashier_demo",
      S3_ENDPOINT: "http://127.0.0.1:59000",
      OPENAI_API_KEY: "demo-unused",
      OPENAI_BASE_URL: "http://127.0.0.1:1/v1",
      DEV_AUTH_BYPASS: "true",
    });
  });

  it("uses explicit valid ports consistently", () => {
    const result = createDemoEnvironment({
      NODE_ENV: "development",
      CASHIER_DEMO_APP_PORT: "3010",
      CASHIER_DEMO_POSTGRES_PORT: "55440",
      CASHIER_DEMO_S3_PORT: "59010",
    });
    expect(result.APP_URL).toBe("http://127.0.0.1:3010");
    expect(result.DATABASE_URL).toContain("127.0.0.1:55440/cashier_demo");
    expect(result.S3_ENDPOINT).toBe("http://127.0.0.1:59010");
    expect(result.S3_PUBLIC_ENDPOINT).toBe("http://127.0.0.1:59010");
    expect(result.CASHIER_DEMO_POSTGRES_PORT).toBe("55440");
    expect(result.CASHIER_DEMO_S3_PORT).toBe("59010");
  });

  it.each(["0", "65536", "3.5", "invalid"])("rejects invalid ports", (port) => {
    expect(() =>
      createDemoEnvironment({ NODE_ENV: "development", CASHIER_DEMO_APP_PORT: port })
    ).toThrow(/CASHIER_DEMO_APP_PORT/);
  });

  /**
   * The database only stores a hash of each key and the settings page shows just
   * the token prefix and suffix, so this banner is the only place a developer
   * can read the seeded tokens from.
   */
  it("prints every seeded sample key with the book it writes to", () => {
    const lines = formatDemoCredentialLines();
    const credentials = fixture.serviceCredentials as Array<{
      name: string;
      book: string;
      tokenBody: string;
    }>;
    const credentialLines = lines.slice(1, -1);

    expect(lines[0]).toContain("Sample API keys");
    expect(lines.at(-1)).toContain("Authorization: Bearer");
    expect(credentialLines).toHaveLength(credentials.length);

    for (const credential of credentials) {
      const token = fixtureCredentialToken(credential);
      const line = credentialLines.find((candidate: string) => candidate.includes(token));
      expect(line, credential.name).toContain(credential.name);
      expect(line).toContain(credential.book);
    }
  });
});

describe("demo command sequencing", () => {
  /** @returns {{ command: string, args: string[] }[]} */
  function recorder() {
    const calls: Array<{ command: string; args: string[] }> = [];
    return {
      calls,
      execute: async (command: string, args: string[]) => {
        calls.push({ command, args });
      },
    };
  }

  const flat = (calls: Array<{ command: string; args: string[] }>) =>
    calls.map((call) => [call.command, ...call.args].join(" ")).join("\n");

  it("answers a bare reset with a preview instead of a rebuild", async () => {
    const { calls, execute } = recorder();

    const result = await runDemoCommands({ args: ["--reset"], environment: {}, execute });

    expect(result.mode).toBe("preview-reset");
    // Only the database the preview reads, and only the read-only report: no
    // schema drop, no migration, no seed, no object storage, no Next.js.
    expect(calls).toEqual([
      {
        command: "docker",
        args: [
          "compose",
          "-p",
          "cashier-demo",
          "-f",
          "docker-compose.demo.yml",
          "up",
          "-d",
          "postgres",
        ],
      },
      { command: process.execPath, args: [...TSX, "scripts/demo-data.ts", "preview-reset"] },
    ]);
    const sequence = flat(calls);
    expect(sequence).not.toContain("reset-schema");
    expect(sequence).not.toContain("migrate-database");
    expect(sequence).not.toContain("minio");
    expect(sequence).not.toContain("storage-bootstrap");
    expect(sequence).not.toContain("next");
  });

  it("rebuilds the demo environment when the reset is confirmed", async () => {
    const { calls, execute } = recorder();

    const result = await runDemoCommands({
      args: ["--reset", "--apply"],
      environment: {},
      execute,
    });

    expect(result.mode).toBe("reset");
    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      [
        "docker",
        "compose",
        "-p",
        "cashier-demo",
        "-f",
        "docker-compose.demo.yml",
        "up",
        "-d",
        "postgres",
        "minio",
        "storage-bootstrap",
      ],
      [process.execPath, ...TSX, "scripts/demo-data.ts", "reset-schema"],
      [process.execPath, ...TSX, "scripts/migrate-database.ts"],
      [process.execPath, ...TSX, "scripts/demo-data.ts", "reset", "--apply"],
    ]);
  });

  it("rebuilds before every normal demo launch", async () => {
    const { calls, execute } = recorder();

    const result = await runDemoCommands({ args: [], environment: {}, execute });

    expect(result.mode).toBe("seed");
    expect(flat(calls)).toContain("scripts/demo-data.ts reset --apply");
  });

  it("reuses the isolated demo environment rather than the caller's", async () => {
    const { execute } = recorder();

    const result = await runDemoCommands({
      args: [],
      environment: { DATABASE_URL: "postgresql://remote.example.com/production" },
      execute,
    });

    expect(result.environment?.DATABASE_URL).toBe(
      "postgresql://cashier:cashier-local-only@127.0.0.1:55433/cashier_demo"
    );
  });
});
