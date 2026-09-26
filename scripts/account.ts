/**
 * Local account commands, run on a machine that can reach the database:
 *
 *   npm run account:create -- --email you@example.com [--book 共同支出 --book …]
 *   npm run account:enroll -- --email you@example.com
 *
 * `create` makes the one account with its ledger, books and categories.
 * `enroll` prints a one-time link that adds a passkey to it; it is also the
 * way back in when every passkey is lost and the email cannot receive codes.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadLocalEnvironment } from "./load-local-environment.mjs";

const DEFAULT_BOOK_NAMES = ["共同支出"];

const emailSchema = z
  .string({ error: "is required" })
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());
const bookNameSchema = z.string().trim().min(1).max(20);

const argsSchema = z.discriminatedUnion("command", [
  z
    .object({
      command: z.literal("create"),
      email: emailSchema,
      books: z
        .array(bookNameSchema)
        .min(1)
        .max(20)
        .refine((names) => new Set(names).size === names.length, "book names must be unique")
        .default(DEFAULT_BOOK_NAMES),
    })
    .strict(),
  z.object({ command: z.literal("enroll"), email: emailSchema }).strict(),
]);

const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "is required" })
    .regex(/^postgres(ql)?:\/\//, "must be a PostgreSQL connection URL"),
  AUTH_SECRET: z.string({ error: "is required" }).trim().min(1, "is required"),
  APP_URL: z.url({ error: "must be the URL the app is served from" }),
});

function parseCommand(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { email: { type: "string" }, book: { type: "string", multiple: true } },
  });
  const parsed = argsSchema.safeParse({
    command: positionals[0],
    email: values.email,
    ...(values.book == null ? {} : { books: values.book }),
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(
      `${issues.join("; ")}\nusage: account.ts create --email <address> [--book <name>]…` +
        `\n       account.ts enroll --email <address>`
    );
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
    if (command.command === "create") {
      const { createInitialAccount } = await import("@/modules/auth/server/initial-account");
      await createInitialAccount({ email: command.email, bookNames: command.books });
      console.log(
        "Created the account, its ledger, books and categories.\n" +
          "Add its first passkey: npm run account:enroll -- --email <the same address>"
      );
      return;
    }

    const { issueEnrollmentToken, ENROLLMENT_TTL_MS } =
      await import("@/modules/auth/server/enrollment");
    const issued = await issueEnrollmentToken(command.email);
    if (issued == null) throw new Error("no account signs in with that email");
    const link = new URL("/enroll", env.data.APP_URL);
    link.searchParams.set("token", issued.token);
    console.log(
      `Open this link within ${ENROLLMENT_TTL_MS / 60_000} minutes to add a passkey. ` +
        "It works once, and replaces any link issued before.\n" +
        link.toString()
    );
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(`[account] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
