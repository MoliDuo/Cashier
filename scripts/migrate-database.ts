import { migrateDatabase } from "@/persistence/migrate";
import { loadLocalEnvironment } from "./load-local-environment";

async function main(): Promise<void> {
  loadLocalEnvironment();
  const connectionString = process.env.DATABASE_URL;
  if (connectionString == null || !/^postgres(ql)?:\/\//.test(connectionString)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  await migrateDatabase(connectionString);
  console.log(JSON.stringify({ mode: "migrate", database: "postgresql", status: "complete" }));
}

main().catch((error: unknown) => {
  console.error(`[db:migrate] ${error instanceof Error ? error.message : String(error)}`);
  // Drizzle wraps the underlying PostgreSQL error in `error.cause`; print the
  // whole cause chain so deployment logs show the real failure reason.
  let cause = error instanceof Error ? error.cause : undefined;
  while (cause instanceof Error) {
    console.error(`[db:migrate] caused by: ${cause.message}`);
    cause = cause.cause;
  }
  process.exitCode = 1;
});
