import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export function loadLocalEnvironment(
  directory: string = process.cwd(),
  env: Record<string, string | undefined> = process.env
): void {
  for (const filename of [".env.local", ".env"]) {
    const envPath = path.resolve(directory, filename);
    if (!existsSync(envPath)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, "utf8")))) {
      if (env[key] === undefined) env[key] = value;
    }
  }
}
