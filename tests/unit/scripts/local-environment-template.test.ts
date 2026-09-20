import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const INTERNAL_SECRET_NAMES = [
  "AUTH_SECRET",
  "API_KEY_PEPPER",
  "RATE_LIMIT_PEPPER",
  "AUTH_OTP_PEPPER",
] as const;

/** Top-level keys of the `services:` mapping, without pulling in a YAML parser. */
function serviceNames(source: string): string[] {
  const names: string[] = [];
  let insideServices = false;
  for (const line of source.split("\n")) {
    if (line.startsWith("services:")) {
      insideServices = true;
      continue;
    }
    if (!insideServices) continue;
    if (line.trim() === "") continue;
    if (!line.startsWith(" ")) break;
    const match = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (match?.[1] != null) names.push(match[1]);
  }
  return names;
}

describe("local environment template", () => {
  it("provides explicit local-only internal secrets for copy-and-run development", () => {
    const template = readFileSync(resolve(process.cwd(), ".env.local.example"), "utf8");
    const environment = parseEnv(template);

    for (const name of INTERNAL_SECRET_NAMES) {
      expect(environment[name]).toContain("cashier-local-only-");
    }
  });

  it("does not put fixed internal secrets in the external deployment template", () => {
    const template = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    const environment = parseEnv(template);

    for (const name of INTERNAL_SECRET_NAMES) {
      expect(environment[name]).toBeUndefined();
    }
  });
});

describe("local Compose stack", () => {
  const compose = readFileSync(resolve(process.cwd(), "docker-compose.local.yml"), "utf8");

  it("runs the backing services and leaves the app to the source checkout", () => {
    expect(serviceNames(compose)).toEqual(["postgres", "minio", "storage-bootstrap"]);
  });

  it("publishes PostgreSQL on loopback only", () => {
    expect(compose).toContain('- "127.0.0.1:5432:5432"');
  });

  it("keeps the named volumes that hold the local database and receipts", () => {
    expect(compose).toContain("cashier_postgres:/var/lib/postgresql/data");
    expect(compose).toContain("cashier_minio:/data");
  });
});

describe("local environment connections", () => {
  it("points the source checkout at the Compose-managed PostgreSQL and MinIO", () => {
    const environment = parseEnv(
      readFileSync(resolve(process.cwd(), ".env.local.example"), "utf8")
    );

    expect(environment.DATABASE_URL).toBe(
      "postgresql://cashier:cashier-local-only@localhost:5432/cashier"
    );
    expect(environment.S3_ENDPOINT).toBe("http://localhost:9000");
    expect(environment.S3_PUBLIC_ENDPOINT).toBe("http://localhost:9000");
    expect(environment.S3_BUCKET).toBe("cashier");
    expect(environment.S3_FORCE_PATH_STYLE).toBe("true");
  });
});
