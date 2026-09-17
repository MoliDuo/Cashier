import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixtureCredentialToken } from "../../../scripts/demo-data.mjs";
import {
  createDemoComposeArgs,
  createDemoDataArgs,
  createDemoEnvironment,
  formatDemoCredentialLines,
} from "../../../scripts/run-demo.mjs";

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

  it("rebuilds fixture data on each demo launch but keeps reset preview-only by default", () => {
    expect(createDemoDataArgs()).toEqual(["scripts/demo-data.mjs", "reset", "--apply"]);
    expect(createDemoDataArgs({ reset: true })).toEqual(["scripts/demo-data.mjs", "reset"]);
    expect(createDemoDataArgs({ reset: true, apply: true })).toEqual([
      "scripts/demo-data.mjs",
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
      COUPLE_OWNER_USER_ID: "external-owner",
      COUPLE_PARTNER_USER_ID: "external-partner",
      COUPLE_LEDGER_ID: "external-ledger",
    });

    expect(result).toMatchObject({
      CASHIER_DEMO_MODE: "true",
      DATABASE_URL: "postgresql://cashier:cashier-local-only@127.0.0.1:55433/cashier_demo",
      S3_ENDPOINT: "http://127.0.0.1:59000",
      OPENAI_API_KEY: "demo-unused",
      OPENAI_BASE_URL: "http://127.0.0.1:1/v1",
      DEV_AUTH_BYPASS: "true",
      COUPLE_OWNER_USER_ID: "10000000-0000-4000-8000-000000000001",
      COUPLE_PARTNER_USER_ID: "10000000-0000-4000-8000-000000000002",
      COUPLE_LEDGER_ID: "20000000-0000-4000-8000-000000000001",
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
  it("prints every seeded sample key with the member that owns it", () => {
    const lines = formatDemoCredentialLines();
    const credentials = fixture.serviceCredentials as Array<{
      name: string;
      attributedTo: string;
      tokenBody: string;
    }>;
    const credentialLines = lines.slice(1, -1);

    expect(lines[0]).toContain("Sample API keys");
    expect(lines.at(-1)).toContain("Authorization: Bearer");
    expect(credentialLines).toHaveLength(credentials.length);

    for (const credential of credentials) {
      const token = fixtureCredentialToken(credential);
      const line = credentialLines.find((candidate) => candidate.includes(token));
      expect(line, credential.name).toContain(credential.name);
      expect(line).toContain(credential.attributedTo === "partner" ? "partner" : "dev");
    }
  });
});
