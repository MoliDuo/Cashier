/**
 * Local account commands, run on a machine that can reach the database:
 *
 *   npm run account:create -- --email you@example.com [--book 共同支出 --book …]
 *   npm run account:add-email -- --email you@example.com
 *
 * `create` makes the one account with its ledger, books and categories. The
 * email is the one the identity provider knows the person by.
 * `add-email` binds one more address to it; it is the way back in when the
 * provider's address for a person changed and nobody can reach the settings page.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadLocalEnvironment } from "./load-local-environment";

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
  z.object({ command: z.literal("add-email"), email: emailSchema }).strict(),
]);

const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "is required" })
    .regex(/^postgres(ql)?:\/\//, "must be a PostgreSQL connection URL"),
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
        `\n       account.ts add-email --email <address>`
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
          "It signs in through the identity provider as that email."
      );
      return;
    }

    const { addLoginEmailToTheAccount } = await import("@/modules/auth/server/login-emails");
    await addLoginEmailToTheAccount(command.email);
    console.log("That email can now sign in.");
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(`[account] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
