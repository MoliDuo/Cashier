type PoolSsl = false | { rejectUnauthorized: boolean } | undefined;

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function resolvePostgresSsl(connectionString: string, nodeEnv: string | undefined): PoolSsl {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  const isLocal = LOCAL_DATABASE_HOSTS.has(url.hostname);

  // `disable` is an explicit choice, for a database on a private network (the compose file's
  // `postgres` host); only a URL that says nothing about TLS is refused.
  if (
    nodeEnv === "production" &&
    !isLocal &&
    sslMode !== "require" &&
    sslMode !== "verify-full" &&
    sslMode !== "disable"
  ) {
    throw new Error(
      "Production DATABASE_URL for a non-local PostgreSQL host requires an explicit sslmode: require, verify-full or disable"
    );
  }

  if (sslMode === "disable") return false;
  if (sslMode === "require") return { rejectUnauthorized: false };
  if (sslMode === "verify-full") return { rejectUnauthorized: true };
  return undefined;
}
