import { sql } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getTestDb, getTestPool } from "tests/setup";
import { createTestSourceDocument, createTestUser, TEST_USER_ID } from "tests/helpers/schema-setup";
import {
  idempotencyRecords,
  ledgers,
  objectCleanupJobs,
  otpTokens,
  serviceCredentials,
  sourceDocuments,
  storedFiles,
  users,
} from "@/persistence";

const mergeScript = resolve("scripts/migrate-couple-ledger.ts");
const pruneScript = resolve("scripts/prune-non-couple-users.ts");

async function fixture() {
  const db = getTestDb();
  const partnerId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  await createTestUser(db, undefined, partnerId);
  await createTestUser(db, undefined, otherId);
  const ownerLedgerId = crypto.randomUUID();
  const partnerLedgerId = crypto.randomUUID();
  const otherLedgerId = crypto.randomUUID();
  await db.insert(ledgers).values([
    { id: ownerLedgerId, userId: TEST_USER_ID },
    { id: partnerLedgerId, userId: partnerId },
    { id: otherLedgerId, userId: otherId },
  ]);
  const partnerDocument = await createTestSourceDocument(db, partnerLedgerId, {
    imageUrls: ["partner.jpg"],
  });
  const otherDocument = await createTestSourceDocument(db, otherLedgerId, {
    imageUrls: ["other.jpg"],
  });
  const credentialId = crypto.randomUUID();
  await db.insert(serviceCredentials).values({
    id: credentialId,
    ledgerId: otherLedgerId,
    tokenHash: "test-hash",
    tokenPrefix: "sk_test",
    tokenSuffix: "suffix",
    name: "other",
    attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${otherLedgerId})`,
  });
  await db.insert(idempotencyRecords).values({
    principalType: "credential",
    principalId: credentialId,
    key: "other-request",
    expiresAt: new Date(Date.now() + 60000),
  });
  const otherEmail = (await db.select().from(users).where(eq(users.id, otherId)))[0]!.email;
  await db.insert(otpTokens).values({
    email: otherEmail,
    tokenHash: crypto.randomUUID(),
    expires: new Date(Date.now() + 60000),
  });

  const schema = (
    await getTestPool().query<{ schema: string }>("SELECT current_schema() AS schema")
  ).rows[0]!.schema;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    COUPLE_OWNER_USER_ID: TEST_USER_ID,
    COUPLE_PARTNER_USER_ID: partnerId,
    COUPLE_LEDGER_ID: ownerLedgerId,
  };
  const run = (script: string, args: string[] = []) =>
    execFileSync(process.execPath, ["--experimental-strip-types", script, ...args], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      timeout: 60000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  return { run, partnerDocument, otherDocument, ownerLedgerId, otherId, otherLedgerId };
}

describe("couple-only database cleanup", () => {
  it("requires an exact preview and leaves member data and the cleanup queue alone", async () => {
    const data = await fixture();
    data.run(mergeScript, ["--apply"]);
    const before = await getTestDb().select().from(sourceDocuments);
    const preview = JSON.parse(data.run(pruneScript));
    expect(preview).toMatchObject({
      mode: "preview",
      otherAccounts: 1,
      otherLedgers: 1,
      otpTokens: 1,
      idempotencyRecords: 1,
      records: { source_documents: 1, stored_files: 1 },
    });
    expect(await getTestDb().select().from(sourceDocuments)).toHaveLength(before.length);
    expect(() => data.run(pruneScript, ["--apply", `--expect=${"0".repeat(64)}`])).toThrow();
    expect(await getTestDb().select().from(users)).toHaveLength(3);

    data.run(pruneScript, ["--apply", `--expect=${preview.targetFingerprint}`]);
    expect(await getTestDb().select().from(users)).toHaveLength(2);
    expect(await getTestDb().select().from(ledgers)).toHaveLength(2);
    expect(await getTestDb().select().from(sourceDocuments)).toHaveLength(1);
    expect((await getTestDb().select().from(sourceDocuments))[0]?.id).toBe(data.partnerDocument);
    expect(await getTestDb().select().from(storedFiles)).toHaveLength(1);
    expect(await getTestDb().select().from(objectCleanupJobs)).toHaveLength(0);
    expect(await getTestDb().select().from(idempotencyRecords)).toHaveLength(0);
    expect(await getTestDb().select().from(otpTokens)).toHaveLength(0);
    expect(() =>
      data.run(pruneScript, ["--apply", `--expect=${preview.targetFingerprint}`])
    ).toThrow();
  });
});
