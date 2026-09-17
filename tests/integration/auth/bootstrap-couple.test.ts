import { spawn, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getTestDb, getTestPool, getTestSchemaName } from "tests/setup";
import { entryCategories, ledgers, users } from "@/persistence";
import { TEST_USER_ID } from "tests/helpers/schema-setup";

function bootstrapEnvironment() {
  const owner = crypto.randomUUID();
  const partner = crypto.randomUUID();
  const ledger = crypto.randomUUID();
  return {
    ...process.env,
    PGOPTIONS: `-c search_path=${getTestSchemaName()},public`,
    COUPLE_OWNER_USER_ID: owner,
    COUPLE_PARTNER_USER_ID: partner,
    COUPLE_LEDGER_ID: ledger,
    COUPLE_OWNER_EMAIL: "person-a@example.test",
    COUPLE_OWNER_PASSWORD: "fixture-pass-123",
    COUPLE_PARTNER_EMAIL: "person-b@example.test",
    COUPLE_PARTNER_PASSWORD: "fixture-pass-456",
  };
}

function runBootstrap(apply = false) {
  return spawnSync(
    process.execPath,
    ["scripts/bootstrap-couple.mjs", ...(apply ? ["--apply"] : [])],
    {
      env: bootstrapEnvironment(),
      encoding: "utf8",
      timeout: 20_000,
    }
  );
}

function runBootstrapAsync(
  env: NodeJS.ProcessEnv
): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/bootstrap-couple.mjs", "--apply"], {
      env,
      timeout: 20_000,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

describe("couple bootstrap command", () => {
  it("previews without writing accounts", async () => {
    const db = getTestDb();
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
    const result = runBootstrap();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: "preview", users: 2, ledgers: 1 });
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("creates two accounts, one ledger and default categories once", async () => {
    const db = getTestDb();
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
    const result = runBootstrap(true);
    expect(result.status, result.stderr).toBe(0);
    expect(await db.select().from(users)).toHaveLength(2);
    expect(await db.select().from(ledgers)).toHaveLength(1);
    expect(await db.select().from(entryCategories)).toHaveLength(
      JSON.parse(result.stdout).categories
    );
    expect(runBootstrap(true).status).not.toBe(0);
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it("rolls back both accounts when category insertion fails", async () => {
    const db = getTestDb();
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
    await getTestPool().query(
      "ALTER TABLE entry_categories ADD CONSTRAINT test_bootstrap_category_failure CHECK (false)"
    );
    const result = runBootstrap(true);
    expect(result.status).not.toBe(0);
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(ledgers)).toHaveLength(0);
    expect(await db.select({ count: sql<number>`count(*)::int` }).from(entryCategories)).toEqual([
      { count: 0 },
    ]);
    await getTestPool().query(
      "ALTER TABLE entry_categories DROP CONSTRAINT test_bootstrap_category_failure"
    );
  });

  it("allows only one concurrent initializer to commit", async () => {
    const db = getTestDb();
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
    const env = bootstrapEnvironment();
    const results = await Promise.all([runBootstrapAsync(env), runBootstrapAsync(env)]);
    expect(results.map((result) => result.status).sort()).toEqual([0, 1]);
    expect(await db.select().from(users)).toHaveLength(2);
    expect(await db.select().from(ledgers)).toHaveLength(1);
  });
});
