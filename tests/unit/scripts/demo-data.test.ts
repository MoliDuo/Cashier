import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateDemoEnvironment } from "../../../scripts/demo-data.mjs";

const fixture = JSON.parse(
  readFileSync(new URL("../../../scripts/fixtures/demo-workspace.json", import.meta.url), "utf8")
);

const safeEnvironment = {
  NODE_ENV: "development",
  CASHIER_DEMO_MODE: "true",
  DATABASE_URL: "postgresql://cashier:cashier@127.0.0.1:55433/cashier_demo",
  S3_ENDPOINT: "http://127.0.0.1:59000",
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
});
