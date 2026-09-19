import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeCredentialHash,
  fixtureCredentialToken,
  previewDemoReset,
  validateDemoEnvironment,
} from "../../../scripts/demo-data.mjs";
import { computeHash } from "@/lib/security/service-credential-token";

/**
 * The preview is judged by what it refuses to do, so every statement the
 * database client is asked to run is recorded, and both object-storage clients
 * count their own construction and sends: a preview that built a storage client
 * would be a preview that could create or delete an object.
 */
const previewState = vi.hoisted(() => ({
  statements: [] as string[],
  storageClients: 0,
  s3Sends: 0,
  catalog: {
    public: {
      tables: ["ledgers", "source_documents", "users"],
      rows: { users: 1, ledgers: 1, source_documents: 29 },
    },
    drizzle: {
      tables: ["__drizzle_migrations"],
      rows: { __drizzle_migrations: 49 },
    },
  } as Record<string, { tables: string[]; rows: Record<string, number> }>,
}));

const catalog = previewState.catalog;

vi.mock("pg", () => ({
  default: {
    Client: class {
      async connect() {}
      async end() {}
      destroy() {}
      async query(sql: string, parameters?: unknown[]) {
        previewState.statements.push(sql);
        // The table listing joins pg_namespace, so it is asked about first.
        if (sql.includes("pg_class")) {
          const schema = String(parameters?.[0]);
          return { rows: (previewState.catalog[schema]?.tables ?? []).map((name) => ({ name })) };
        }
        if (sql.includes("FROM pg_namespace")) {
          const schema = String(parameters?.[0]);
          return { rows: previewState.catalog[schema] == null ? [] : [{ "?column?": 1 }] };
        }
        const counted = /FROM "([^"]+)"\."([^"]+)"/.exec(sql);
        if (counted != null) {
          const [, schema = "", table = ""] = counted;
          return { rows: [{ count: previewState.catalog[schema]?.rows[table] ?? null }] };
        }
        return { rows: [] };
      }
    },
  },
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor() {
      previewState.storageClients += 1;
    }
    async send() {
      previewState.s3Sends += 1;
    }
    destroy() {}
  },
  PutObjectCommand: class {},
  DeleteObjectsCommand: class {},
}));

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

// Anything that is not a read: a preview that ran one of these would be a
// rebuild wearing a preview label.
const WRITES = /\b(DROP|CREATE|TRUNCATE|DELETE|INSERT|UPDATE|ALTER|GRANT|VACUUM|REINDEX)\b/i;

const DEFAULT_CATALOG = {
  public: ["ledgers", "source_documents", "users"],
  publicRows: { users: 1, ledgers: 1, source_documents: 29 },
  drizzle: ["__drizzle_migrations"],
  drizzleRows: { __drizzle_migrations: 49 },
} as const;

let lines: string[] = [];
const consoleLines = () => lines;
const statements = () => previewState.statements;

beforeEach(() => {
  previewState.statements = [];
  previewState.storageClients = 0;
  previewState.s3Sends = 0;
  catalog.public = { tables: [...DEFAULT_CATALOG.public], rows: { ...DEFAULT_CATALOG.publicRows } };
  catalog.drizzle = {
    tables: [...DEFAULT_CATALOG.drizzle],
    rows: { ...DEFAULT_CATALOG.drizzleRows },
  };
  lines = [];
  vi.spyOn(console, "log").mockImplementation((...arguments_) => {
    lines.push(arguments_.map(String).join(" "));
  });
});

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
    const books = fixture.books as Array<{ name: string }>;
    const documents = fixture.documents as Array<{
      title: string | null;
      book: string;
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
    // Three books, every document in one of them: the switcher and the
    // per-book totals both need all three represented, and an orphaned record
    // would be invisible in every view.
    expect(books).toHaveLength(3);
    const bookNames = new Set(books.map((book) => book.name));
    expect(documents.every((document) => bookNames.has(document.book))).toBe(true);
    for (const book of books) {
      expect(documents.some((document) => document.book === book.name)).toBe(true);
    }
    const partnerDocuments = documents.filter((document) => document.book === "梁梁的");
    expect(partnerDocuments.some((document) => document.title === "FreshMart")).toBe(true);
    expect(partnerDocuments.some((document) => document.title === "City Taxi")).toBe(true);
    expect(partnerDocuments.every((document) => document.status === "completed")).toBe(true);
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

  it("seeds sample API keys, each bound to a book, in the real token format", () => {
    const credentials = fixture.serviceCredentials as Array<{
      id: string;
      name: string;
      book: string;
      tokenBody: string;
    }>;

    expect(credentials).toHaveLength(3);
    for (const credential of credentials) {
      expect(fixtureCredentialToken(credential)).toMatch(/^sk_live_[0-9a-f]{48}$/);
      expect(credential.name.length).toBeGreaterThan(0);
    }
    // Every key names a real book, so an upload through it has somewhere to go.
    const bookNames = new Set((fixture.books as Array<{ name: string }>).map((book) => book.name));
    expect(credentials.every((credential) => bookNames.has(credential.book))).toBe(true);
    expect(credentials.filter((credential) => credential.book === "哞哞的")).toHaveLength(2);
    expect(credentials.filter((credential) => credential.book === "梁梁的")).toHaveLength(1);
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

describe("demo reset preview", () => {
  it("reports what a reset would replace without dropping, migrating or seeding", async () => {
    const result = await previewDemoReset({
      NODE_ENV: "development",
      CASHIER_DEMO_MODE: "true",
      DATABASE_URL: "postgresql://cashier:cashier@127.0.0.1:55433/cashier_demo",
      S3_ENDPOINT: "http://127.0.0.1:59000",
      API_KEY_PEPPER: "test-pepper-for-testing-only",
    });

    expect(result).toMatchObject({
      mode: "preview-reset",
      apply: false,
      database: "127.0.0.1:55433/cashier_demo",
      schemas: {
        public: {
          exists: true,
          tables: ["ledgers", "source_documents", "users"],
          rows: {
            users: 1,
            ledgers: 1,
            source_documents: 29,
            ledger_entries: null,
            stored_files: null,
          },
        },
        drizzle: {
          exists: true,
          tables: ["__drizzle_migrations"],
          rows: { __drizzle_migrations: 49 },
        },
      },
    });
    const printed = consoleLines().join("\n");
    expect(printed).toContain('"mode":"preview-reset"');
    expect(printed).toContain('"apply":false');
    expect(printed).toContain("npm run demo:reset -- --apply");
    // The connection string carries the demo database's credentials, and this
    // report is meant to be pasted around.
    expect(printed).not.toContain("cashier:cashier@");
  });

  it("writes nothing while previewing", async () => {
    await previewDemoReset(safeEnvironment);

    // A READ ONLY transaction is what makes the promise enforceable rather than
    // aspirational: a write added here would fail instead of dropping a schema.
    expect(statements()).toContain("BEGIN READ ONLY");
    expect(statements()).toContain("COMMIT");
    expect(statements().filter((sql) => WRITES.test(sql))).toEqual([]);
    // Neither MinIO nor its bucket bootstrap is involved: no object can be
    // created or deleted by a preview.
    expect(previewState.storageClients).toBe(0);
    expect(previewState.s3Sends).toBe(0);
  });

  it("describes a database that has not been migrated yet", async () => {
    catalog.public = { tables: ["users"], rows: { users: 3 } };
    catalog.drizzle = { tables: [], rows: {} };

    const result = await previewDemoReset(safeEnvironment);

    expect(result.schemas.public).toEqual({
      exists: true,
      tables: ["users"],
      rows: {
        users: 3,
        ledgers: null,
        source_documents: null,
        ledger_entries: null,
        stored_files: null,
      },
    });
    expect(result.schemas.drizzle).toEqual({ exists: true, tables: [], rows: {} });
  });

  it("names an empty database as an absent target instead of migrating it", async () => {
    delete catalog.public;
    delete catalog.drizzle;

    const result = await previewDemoReset(safeEnvironment);

    expect(result.schemas.public).toEqual({
      exists: false,
      tables: [],
      rows: {
        users: null,
        ledgers: null,
        source_documents: null,
        ledger_entries: null,
        stored_files: null,
      },
    });
    expect(result.schemas.drizzle).toEqual({ exists: false, tables: [], rows: {} });
    expect(statements().filter((sql) => WRITES.test(sql))).toEqual([]);
  });

  it("refuses any database that is not the dedicated demo one", async () => {
    await expect(
      previewDemoReset({
        ...safeEnvironment,
        DATABASE_URL: "postgresql://cashier@db.example.com/cashier_demo",
      })
    ).rejects.toThrow(/loopback/);
    expect(previewState.storageClients).toBe(0);
    expect(statements()).toEqual([]);
  });
});
