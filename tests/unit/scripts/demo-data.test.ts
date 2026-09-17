import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeCredentialHash,
  fixtureCredentialToken,
  validateDemoEnvironment,
} from "../../../scripts/demo-data.mjs";
import { computeHash } from "@/lib/security/service-credential-token";

const fixture = JSON.parse(
  readFileSync(new URL("../../../scripts/fixtures/demo-workspace.json", import.meta.url), "utf8")
);

const safeEnvironment = {
  NODE_ENV: "development",
  CASHIER_DEMO_MODE: "true",
  DATABASE_URL: "postgresql://cashier:cashier@127.0.0.1:55433/cashier_demo",
  S3_ENDPOINT: "http://127.0.0.1:59000",
  API_KEY_PEPPER: "test-pepper-for-testing-only",
} satisfies NodeJS.ProcessEnv;

afterEach(() => vi.restoreAllMocks());

describe("demo data environment guard", () => {
  it("accepts only the dedicated loopback resources", () => {
    expect(validateDemoEnvironment(safeEnvironment)).toEqual({
      databaseUrl: safeEnvironment.DATABASE_URL,
      storageUrl: `${safeEnvironment.S3_ENDPOINT}/`,
    });
  });

  it.each([
    [{ ...safeEnvironment, CASHIER_DEMO_MODE: "false" }, /CASHIER_DEMO_MODE/],
    [{ ...safeEnvironment, DATABASE_URL: "postgresql://db.example.com/cashier_demo" }, /loopback/],
    [
      { ...safeEnvironment, DATABASE_URL: "postgresql://cashier@127.0.0.1/cashier" },
      /cashier_demo/,
    ],
    [{ ...safeEnvironment, S3_ENDPOINT: "https://storage.example.com" }, /loopback/],
    [{ ...safeEnvironment, API_KEY_PEPPER: "   " }, /API_KEY_PEPPER/],
  ])("rejects unsafe resources", (environment, message) => {
    expect(() => validateDemoEnvironment(environment)).toThrow(message);
  });
});

describe("demo workspace fixture", () => {
  it("covers representative display and accounting edge cases", () => {
    const documents = fixture.documents as Array<{
      title: string | null;
      attributedTo?: string;
      status: string;
      failureKind?: string;
      failureCode?: string;
      retainedResult?: {
        entries: Array<{ category: string | null; amount: string; currency: string }>;
      };
      entries: Array<{ category: string | null; amount: string; currency: string }>;
    }>;
    const entries = documents.flatMap(
      (document) => document.retainedResult?.entries ?? document.entries
    );

    expect(documents).toHaveLength(29);
    expect(entries).toHaveLength(26);
    const partnerDocuments = documents.filter((document) => document.attributedTo === "partner");
    expect(partnerDocuments).toHaveLength(6);
    expect(partnerDocuments.some((document) => document.title === "FreshMart")).toBe(true);
    expect(partnerDocuments.some((document) => document.title === "City Taxi")).toBe(true);
    expect(partnerDocuments.every((document) => document.status === "completed")).toBe(true);
    expect(
      documents.every(
        (document) => document.attributedTo == null || document.attributedTo === "partner"
      )
    ).toBe(true);
    expect(documents.some((document) => document.title == null)).toBe(true);
    expect(documents.some((document) => document.status === "cancelled")).toBe(true);
    expect(entries.some((entry) => entry.category == null)).toBe(true);
    expect(entries.some((entry) => Number(entry.amount) < 0)).toBe(true);
    expect(entries.some((entry) => Number(entry.amount) >= 100_000)).toBe(true);
    expect(new Set(entries.map((entry) => entry.currency))).toEqual(
      new Set(["CNY", "USD", "MYR", "SGD", "JPY", "KWD"])
    );
  });

  it("covers every stable failure reason and a failed retry with retained results", () => {
    const failed = fixture.documents.filter(
      (document: { status: string }) => document.status === "failed"
    ) as Array<{
      failureKind: string;
      failureCode: string;
      retainedResult?: { entries: unknown[] };
    }>;

    expect(failed).toHaveLength(13);
    expect(
      new Set(
        failed
          .filter((document) => document.failureKind === "invalid_input")
          .map((document) => document.failureCode)
      )
    ).toEqual(new Set(["ai_declared_invalid", "entry_validation_failed"]));
    expect(
      new Set(
        failed
          .filter((document) => document.failureKind === "processing_error")
          .map((document) => document.failureCode)
      )
    ).toEqual(
      new Set([
        "ai_provider_unavailable",
        "ai_schema_invalid",
        "exchange_rate_failure",
        "storage_failure",
        "processing_unavailable",
        "database_unavailable",
        "request_bound_retry_exhausted",
        "processing_timeout",
      ])
    );
    expect(failed.filter((document) => document.retainedResult?.entries.length === 2)).toHaveLength(
      1
    );
  });

  it("seeds sample API keys for both members in the real token format", () => {
    const credentials = fixture.serviceCredentials as Array<{
      id: string;
      name: string;
      attributedTo: string;
      tokenBody: string;
    }>;

    expect(credentials).toHaveLength(3);
    for (const credential of credentials) {
      expect(fixtureCredentialToken(credential)).toMatch(/^sk_live_[0-9a-f]{48}$/);
      expect(credential.name.length).toBeGreaterThan(0);
    }
    expect(credentials.filter((credential) => credential.attributedTo === "user")).toHaveLength(2);
    expect(credentials.filter((credential) => credential.attributedTo === "partner")).toHaveLength(
      1
    );
    expect(new Set(credentials.map((credential) => credential.id)).size).toBe(credentials.length);
    expect(new Set(credentials.map((credential) => fixtureCredentialToken(credential))).size).toBe(
      credentials.length
    );
  });

  /**
   * The fixture stores only the token body: a literal `sk_live_` followed by 48
   * hex characters trips GitHub push protection as a Stripe-shaped key, so the
   * prefix is applied when the token is composed.
   */
  it("never stores a complete credential token in the fixture", () => {
    const fixtures = JSON.stringify(fixture);

    expect(fixtures).not.toMatch(/sk_live_[0-9a-zA-Z]{24,}/);
  });

  /**
   * The script cannot import src/lib/security/service-credential-token.ts, so
   * this is what keeps its copy of the rule from drifting away from the app's.
   */
  it("hashes fixture tokens exactly like the app does", () => {
    const pepper = process.env.API_KEY_PEPPER ?? "";
    const credentials = fixture.serviceCredentials as Array<{ tokenBody: string }>;

    expect(pepper).not.toBe("");
    for (const credential of credentials) {
      const token = fixtureCredentialToken(credential);
      expect(computeCredentialHash(token, pepper)).toBe(computeHash(token));
    }
  });
});
