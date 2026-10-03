/**
 * Creates the one ledger, run on a machine that can reach the database:
 *
 *   npm run ledger:create [-- --book 共同支出 --book …]
 *
 * It makes the ledger with its books and default categories. Who may sign in is
 * decided by the identity provider, so no person is named here.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadLocalEnvironment } from "./load-local-environment";

const DEFAULT_BOOK_NAMES = ["共同支出"];

const bookNameSchema = z.string().trim().min(1).max(20);

const argsSchema = z
  .object({
    command: z.literal("create"),
    books: z
      .array(bookNameSchema)
      .min(1)
      .max(20)
      .refine((names) => new Set(names).size === names.length, "book names must be unique")
      .default(DEFAULT_BOOK_NAMES),
  })
  .strict();

const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "is required" })
    .regex(/^postgres(ql)?:\/\//, "must be a PostgreSQL connection URL"),
});

function parseCommand(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { book: { type: "string", multiple: true } },
  });
  const parsed = argsSchema.safeParse({
    command: positionals[0],
    ...(values.book == null ? {} : { books: values.book }),
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`${issues.join("; ")}\nusage: ledger.ts create [--book <name>]…`);
  }
  return parsed.data;
}

async function main() {
  const command = parseCommand(process.argv.slice(2));
  loadLocalEnvironment();
  const env = envSchema.safeParse(process.env);
  if (!env.success) {
    throw new Error(
      env.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")
    );
  }

  // Imported only now: the database client reads the environment as it loads.
  const { closeDatabase } = await import("@/lib/db");
  try {
    const { createInitialLedger } = await import("@/modules/ledger/server/initial-ledger");
    await createInitialLedger({ bookNames: command.books });
    console.log("Created the ledger, its books and categories.");
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(`[ledger] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
