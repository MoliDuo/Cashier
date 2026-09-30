/**
 * Moves ready files stored under an older key layout to `stored/<id>`, run on
 * a machine that can reach the database and the bucket:
 *
 *   npm run storage:relocate            # lists what would move, changes nothing
 *   npm run storage:relocate -- --apply # moves them
 *
 * Each file is copied, its row repointed only if it still names the old key,
 * and the old object deleted after that, so a run can stop at any step and be
 * run again.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadLocalEnvironment } from "./load-local-environment";

const SAMPLE_SIZE = 5;

const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "is required" })
    .regex(/^postgres(ql)?:\/\//, "must be a PostgreSQL connection URL"),
  S3_BUCKET: z.string({ error: "is required" }).min(1, "is required"),
  S3_ACCESS_KEY_ID: z.string({ error: "is required" }).min(1, "is required"),
  S3_SECRET_ACCESS_KEY: z.string({ error: "is required" }).min(1, "is required"),
});

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { apply: { type: "boolean", default: false } },
  });
  loadLocalEnvironment();
  const env = envSchema.safeParse(process.env);
  if (!env.success) {
    throw new Error(
      env.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")
    );
  }

  // Imported only now: the database client reads the environment as it loads.
  const { closeDatabase } = await import("@/lib/db");
  const { findFilesToRelocate, findObjectsOutsideLayout, relocateStoredFile } =
    await import("@/server/stored-files/relocation");
  try {
    const files = await findFilesToRelocate();
    const totalBytes = files.reduce((sum, file) => sum + file.byteSize, 0);
    console.log(`[storage:relocate] bucket ${env.data.S3_BUCKET}`);
    console.log(
      `[storage:relocate] ${files.length} ready file(s) to move to stored/<id>, ${formatBytes(totalBytes)}`
    );
    for (const file of files.slice(0, SAMPLE_SIZE)) {
      console.log(`  ${file.storageKey} -> stored/${file.id}`);
    }

    if (values.apply) {
      const outcomes = { moved: 0, moved_old_kept: 0, row_changed: 0, failed: 0 };
      for (const [index, file] of files.entries()) {
        try {
          outcomes[await relocateStoredFile(file)] += 1;
        } catch (error) {
          outcomes.failed += 1;
          console.error(
            `[storage:relocate] ${file.id} failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        if ((index + 1) % 50 === 0) {
          console.log(`[storage:relocate] ${index + 1}/${files.length}`);
        }
      }
      console.log(`[storage:relocate] ${JSON.stringify(outcomes)}`);
      if (outcomes.failed > 0) process.exitCode = 1;
    }

    const outside = await findObjectsOutsideLayout(SAMPLE_SIZE);
    console.log(
      `[storage:relocate] ${outside.count} object(s) outside stored/ and temporary/, ${formatBytes(outside.byteSize)}`
    );
    for (const key of outside.sample) console.log(`  ${key}`);
    if (!values.apply) {
      console.log("[storage:relocate] Nothing changed. Run with --apply to move the files.");
    }
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(`[storage:relocate] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
