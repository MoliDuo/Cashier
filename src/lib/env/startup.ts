import { z } from "zod";
import { AppError } from "@/lib/errors";
import { isValidAuthEmailFrom } from "@/lib/utils/email";
export const ENV_DEFAULTS = {
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  APP_URL: "http://localhost:3000",
  TZ: "Asia/Shanghai",
  AI_MODEL: "gpt-4o",
  S3_REGION: "auto",
  S3_FORCE_PATH_STYLE: "false",
  AUTH_EMAIL_FROM: "Cashier <noreply@example.com>",
  LOG_LEVEL: "info",
  DEV_AUTH_BYPASS: "false",
  DATABASE_POOL_MAX: "2",
} as const;

function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function getDefaultString(name: keyof typeof ENV_DEFAULTS): string {
  return ENV_DEFAULTS[name];
}

function requiredString(name: string) {
  return z.preprocess(blankToUndefined, z.string().trim().min(1, `${name} is required`));
}

function requiredPostgresUrl(name: string) {
  return z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^postgres(?:ql)?:\/\//, `${name} must be a PostgreSQL connection URL`)
  );
}

function stringWithDefault(name: keyof typeof ENV_DEFAULTS) {
  return z.preprocess(blankToUndefined, z.string().trim().default(getDefaultString(name)));
}

function urlWithDefault(name: keyof typeof ENV_DEFAULTS) {
  return z.preprocess(
    blankToUndefined,
    z.url({ error: `${name} must be a valid URL` }).default(getDefaultString(name))
  );
}

function booleanStringWithDefault(name: keyof typeof ENV_DEFAULTS) {
  return z.preprocess(
    blankToUndefined,
    z.enum(["true", "false"]).default(getDefaultString(name) as "true" | "false")
  );
}

const startupEnvFields = {
  DATABASE_URL: requiredPostgresUrl("DATABASE_URL"),
  API_KEY_PEPPER: requiredString("API_KEY_PEPPER"),
  OPENAI_API_KEY: requiredString("OPENAI_API_KEY"),
  OPENAI_BASE_URL: urlWithDefault("OPENAI_BASE_URL"),
  AUTH_SECRET: requiredString("AUTH_SECRET"),
  APP_URL: urlWithDefault("APP_URL"),
  AUTH_RESEND_KEY: z.preprocess(blankToUndefined, z.string().trim().optional()),
  AUTH_OTP_PEPPER: requiredString("AUTH_OTP_PEPPER"),
  AUTH_EMAIL_FROM: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .refine(
        isValidAuthEmailFrom,
        "AUTH_EMAIL_FROM must be a valid email address or Display Name <email> mailbox"
      )
      .default(getDefaultString("AUTH_EMAIL_FROM"))
  ),
  S3_ENDPOINT: z.preprocess(blankToUndefined, z.url({ error: "S3_ENDPOINT must be a valid URL" })),
  S3_PUBLIC_ENDPOINT: z.preprocess(
    blankToUndefined,
    z.url({ error: "S3_PUBLIC_ENDPOINT must be a valid URL" }).optional()
  ),
  S3_REGION: stringWithDefault("S3_REGION"),
  S3_BUCKET: requiredString("S3_BUCKET"),
  S3_ACCESS_KEY_ID: requiredString("S3_ACCESS_KEY_ID"),
  S3_SECRET_ACCESS_KEY: requiredString("S3_SECRET_ACCESS_KEY"),
  S3_FORCE_PATH_STYLE: booleanStringWithDefault("S3_FORCE_PATH_STYLE"),
  TRUSTED_PROXY: z.preprocess(blankToUndefined, z.literal("platform").optional()),
  TZ: stringWithDefault("TZ"),
  AI_MODEL: stringWithDefault("AI_MODEL"),
  LOG_LEVEL: stringWithDefault("LOG_LEVEL"),
  DEV_AUTH_BYPASS: booleanStringWithDefault("DEV_AUTH_BYPASS"),
  DATABASE_POOL_MAX: z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .int("DATABASE_POOL_MAX must be an integer")
      .min(1, "DATABASE_POOL_MAX must be between 1 and 50")
      .max(50, "DATABASE_POOL_MAX must be between 1 and 50")
      .default(Number.parseInt(getDefaultString("DATABASE_POOL_MAX"), 10))
  ),
} satisfies z.ZodRawShape;

const startupEnvSchema = z.object(startupEnvFields);

export type StartupEnv = z.infer<typeof startupEnvSchema>;

const parsedFields = new Map<keyof StartupEnv, { raw: string | undefined; value: unknown }>();

export function getStartupEnvValue<K extends keyof StartupEnv>(
  name: K,
  env: NodeJS.ProcessEnv = process.env
): StartupEnv[K] {
  const raw = env[name];
  const cached = parsedFields.get(name);
  if (cached != null && cached.raw === raw) return cached.value as StartupEnv[K];
  const schema = startupEnvFields[name];
  const result = schema.safeParse(raw);

  if (result.success) {
    parsedFields.set(name, { raw, value: result.data });
    return result.data as StartupEnv[K];
  }

  const issues = result.error.issues.map((issue) => issue.message);
  throw new AppError(
    `Startup environment validation failed: ${String(name)}: ${issues.join("; ")}`,
    "STARTUP_ENV_INVALID",
    500,
    { issues: result.error.issues }
  );
}

export function validateStartupEnv(env: NodeJS.ProcessEnv = process.env): StartupEnv {
  const result = startupEnvSchema.safeParse(env);

  if (result.success) {
    if (result.data.DEV_AUTH_BYPASS === "true" && !isSafeDevAuthEnvironment(env, result.data)) {
      throw new AppError(
        "Startup environment validation failed: DEV_AUTH_BYPASS requires test or local development",
        "STARTUP_ENV_INVALID",
        500,
        {
          issues: [
            {
              path: ["DEV_AUTH_BYPASS"],
              message: "DEV_AUTH_BYPASS requires test or local development",
            },
          ],
        }
      );
    }
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path === "" ? issue.message : `${path}: ${issue.message}`;
  });

  throw new AppError(
    `Startup environment validation failed: ${issues.join("; ")}`,
    "STARTUP_ENV_INVALID",
    500,
    { issues: result.error.issues }
  );
}

function isSafeDevAuthEnvironment(env: NodeJS.ProcessEnv, parsed: StartupEnv): boolean {
  if (env.NODE_ENV === "test") return true;
  if (env.NODE_ENV !== "development") return false;
  const hostname = new URL(parsed.APP_URL).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
