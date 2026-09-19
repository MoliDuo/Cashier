import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

const migrationsDirectory = path.resolve("src/persistence/postgres-migrations");
const journal = JSON.parse(
  readFileSync(path.join(migrationsDirectory, "meta/_journal.json"), "utf8")
) as { entries: JournalEntry[] };

describe("Postgres migration journal", () => {
  it("contains only the documented legacy timestamp inversions", () => {
    const allowedLegacyInversions = new Set(["0010_user_preferences", "0011_little_junta"]);
    const observedInversions = new Set<string>();
    let greatestTimestamp = -Infinity;

    journal.entries.forEach((entry, index) => {
      expect(entry.idx).toBe(index);
      if (entry.when <= greatestTimestamp) {
        observedInversions.add(entry.tag);
        expect(allowedLegacyInversions.has(entry.tag)).toBe(true);
      }
      greatestTimestamp = Math.max(greatestTimestamp, entry.when);
    });

    expect(observedInversions).toEqual(allowedLegacyInversions);
    expect(journal.entries.at(-1)?.tag).toBe("0049_drop_book_default");
  });

  it("keeps the harmful global category reorder migration as an intentional no-op", () => {
    const sql = readFileSync(
      path.join(migrationsDirectory, "0042_reorder_default_categories.sql"),
      "utf8"
    );
    expect(sql).toContain("SELECT 1;");
    expect(sql).not.toContain("UPDATE entry_categories");
  });

  it("recovers every schema change skipped by the legacy inversions", () => {
    const sql = readFileSync(
      path.join(migrationsDirectory, "0012_recover_skipped_migrations.sql"),
      "utf8"
    );

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "preferences"');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "ck_processing_attempts_status"');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "ck_processing_outbox_status"');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "ck_source_document_revisions_outcome"');
    expect(sql).toContain("'cancelled'");
    expect(sql).toContain("'abandoned'");
  });

  it("backfills registration completion in the auth session migration", () => {
    const sql = readFileSync(
      path.join(migrationsDirectory, "0029_auth_session_registration_state.sql"),
      "utf8"
    );
    expect(sql).toContain('"auth_version" integer DEFAULT 1 NOT NULL');
    expect(sql).toContain('SET "registration_completed_at" = "created_at"');
    expect(sql).toContain("ck_users_auth_version_positive");
  });

  it("keeps the journal in sync with the actual migration files", () => {
    const sqlFiles = readdirSync(migrationsDirectory)
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .sort();
    const sqlByPrefix = new Map(sqlFiles.map((file) => [file.slice(0, 4), file]));

    expect(sqlFiles.length).toBeGreaterThan(0);
    for (const entry of journal.entries) {
      const prefix = entry.tag.split("_")[0]!;
      const hasSnapshot = existsSync(
        path.join(migrationsDirectory, "meta", `${prefix}_snapshot.json`)
      );
      if (hasSnapshot) continue;
      const sqlFile = sqlByPrefix.get(prefix);
      if (sqlFile == null) {
        throw new Error(`journal entry ${entry.tag} needs a SQL migration file`);
      }
      expect(entry.tag).toBe(sqlFile.replace(/\.sql$/, ""));
    }

    // The journal's last entry must name the newest SQL migration exactly.
    const newestSqlFile = sqlFiles[sqlFiles.length - 1]!;
    expect(journal.entries.at(-1)?.tag).toBe(newestSqlFile.replace(/\.sql$/, ""));
  });

  it("registers every hand-written migration without a same-prefix snapshot", () => {
    const manual = JSON.parse(
      readFileSync(path.join(migrationsDirectory, "meta", "_manual-migrations.json"), "utf8")
    ) as { migrations: Array<{ file: string; sha256: string }> };
    const registered = new Map(manual.migrations.map((entry) => [entry.file, entry.sha256]));
    const sqlFiles = readdirSync(migrationsDirectory)
      .filter(
        (file) =>
          /^\d{4}_.+\.sql$/.test(file) &&
          !existsSync(path.join(migrationsDirectory, "meta", `${file.slice(0, 4)}_snapshot.json`))
      )
      .sort();

    expect(sqlFiles.length).toBeGreaterThan(0);
    expect(registered.has("0035_maintenance_work_lifecycle.sql")).toBe(false);
    for (const file of new Set([...sqlFiles, ...registered.keys()])) {
      const sha256 = createHash("sha256")
        .update(readFileSync(path.join(migrationsDirectory, file)))
        .digest("hex");
      expect(
        registered.get(file),
        `${file} must be registered in meta/_manual-migrations.json`
      ).toBe(sha256);
    }
  });

  it("keeps auxiliary metadata out of Drizzle's snapshot discovery", () => {
    const discovered = readdirSync(path.join(migrationsDirectory, "meta")).filter(
      (file) => !file.startsWith("_")
    );
    expect(discovered.length).toBeGreaterThan(0);
    for (const file of discovered) expect(file).toMatch(/^\d{4}_snapshot\.json$/);
  });

  it("allows db:generate when the snapshot baseline matches the journal", () => {
    let message = "";
    try {
      execFileSync(process.execPath, ["scripts/guard-drizzle-generate.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("");
  });
});
