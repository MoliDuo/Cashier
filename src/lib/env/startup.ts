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
  AI_MAX_RETRIES: "3",
  AI_RETRY_DELAY_MS: "1000",
  AI_REQUEST_TIMEOUT_MS: "60000",
  AI_REVISION_DEADLINE_MS: "180000",
  AI_CATEGORY_CONCURRENCY: "100",
  AI_CATEGORY_REQUEST_TIMEOUT_MS: "60000",
  AI_CATEGORY_MAX_ATTEMPTS: "3",
  UPLOAD_PLAN_LIMIT_PER_15_MIN: "20",
  UPLOAD_OPEN_SESSION_LIMIT: "5",
  UPLOAD_DAILY_BYTES_LIMIT: "104857600",
  AI_TEMPERATURE: "0.3",
  SOURCE_DOC_STALE_TIME_MS: "120000",
  CURRENCY_STALE_TIME_MS: "14400000",
  OTP_EXPIRES_SECONDS: "300",
  OTP_LOCKOUT_MINUTES: "15",
  OTP_MAX_ATTEMPTS: "5",
  OTP_RESEND_COOLDOWN_SECONDS: "60",
  AUTH_RATE_LIMIT_MAX: "10",
  AUTH_RATE_LIMIT_WINDOW: "900",
  AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS: "10",
  AUTH_PASSWORD_IP_MAX_ATTEMPTS: "50",
  AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS: "900",
  API_RATE_LIMIT_PER_MINUTE: "60",
  OTP_IP_MAX_ATTEMPTS_PER_HOUR: "10",
  OTP_VERIFY_MAX_ATTEMPTS_PER_MINUTE: "5",
  SESSION_MAX_AGE_DAYS: "14",
  AUTH_EMAIL_FROM: "Cashier <noreply@example.com>",
  MAX_INPUT_PIXELS: "25000000",
  MAX_IMAGE_QUALITY: "85",
  LOG_LEVEL: "info",
  DEV_AUTH_BYPASS: "false",
  DATABASE_POOL_MAX: "2",
  PROCESSING_RECOVERY_MAX_BATCH: "5",
  PROCESSING_RECOVERY_MAX_ATTEMPTS: "5",
  PROCESSING_RECOVERY_COOLDOWN_SECONDS: "60",
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

function nonNegativeIntWithDefault(name: keyof typeof ENV_DEFAULTS) {
  return z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .int(`${name} must be an integer`)
      .nonnegative(`${name} must be a non-negative integer`)
      .default(Number.parseInt(getDefaultString(name), 10))
  );
}

function positiveIntWithDefault(name: keyof typeof ENV_DEFAULTS) {
  return z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .int(`${name} must be an integer`)
      .positive(`${name} must be a positive integer`)
      .default(Number.parseInt(getDefaultString(name), 10))
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
  RATE_LIMIT_PEPPER: requiredString("RATE_LIMIT_PEPPER"),
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
  AI_MAX_RETRIES: nonNegativeIntWithDefault("AI_MAX_RETRIES"),
  AI_RETRY_DELAY_MS: nonNegativeIntWithDefault("AI_RETRY_DELAY_MS"),
  AI_REQUEST_TIMEOUT_MS: positiveIntWithDefault("AI_REQUEST_TIMEOUT_MS"),
  AI_REVISION_DEADLINE_MS: positiveIntWithDefault("AI_REVISION_DEADLINE_MS"),
  AI_CATEGORY_CONCURRENCY: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(256).default(100)
  ),
  AI_CATEGORY_REQUEST_TIMEOUT_MS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1000).max(180000).default(60000)
  ),
  AI_CATEGORY_MAX_ATTEMPTS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(5).default(3)
  ),
  UPLOAD_PLAN_LIMIT_PER_15_MIN: positiveIntWithDefault("UPLOAD_PLAN_LIMIT_PER_15_MIN"),
  UPLOAD_OPEN_SESSION_LIMIT: positiveIntWithDefault("UPLOAD_OPEN_SESSION_LIMIT"),
  UPLOAD_DAILY_BYTES_LIMIT: positiveIntWithDefault("UPLOAD_DAILY_BYTES_LIMIT"),
  AI_TEMPERATURE: z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .min(0, "AI_TEMPERATURE must be between 0 and 2")
      .max(2, "AI_TEMPERATURE must be between 0 and 2")
      .default(Number.parseFloat(getDefaultString("AI_TEMPERATURE")))
  ),
  SOURCE_DOC_STALE_TIME_MS: nonNegativeIntWithDefault("SOURCE_DOC_STALE_TIME_MS"),
  CURRENCY_STALE_TIME_MS: nonNegativeIntWithDefault("CURRENCY_STALE_TIME_MS"),
  OTP_EXPIRES_SECONDS: positiveIntWithDefault("OTP_EXPIRES_SECONDS"),
  OTP_LOCKOUT_MINUTES: positiveIntWithDefault("OTP_LOCKOUT_MINUTES"),
  OTP_MAX_ATTEMPTS: positiveIntWithDefault("OTP_MAX_ATTEMPTS"),
  OTP_RESEND_COOLDOWN_SECONDS: nonNegativeIntWithDefault("OTP_RESEND_COOLDOWN_SECONDS"),
  AUTH_RATE_LIMIT_MAX: positiveIntWithDefault("AUTH_RATE_LIMIT_MAX"),
  AUTH_RATE_LIMIT_WINDOW: positiveIntWithDefault("AUTH_RATE_LIMIT_WINDOW"),
  AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS: positiveIntWithDefault("AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS"),
  AUTH_PASSWORD_IP_MAX_ATTEMPTS: positiveIntWithDefault("AUTH_PASSWORD_IP_MAX_ATTEMPTS"),
  AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS: positiveIntWithDefault(
    "AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS"
  ),
  API_RATE_LIMIT_PER_MINUTE: positiveIntWithDefault("API_RATE_LIMIT_PER_MINUTE"),
  OTP_IP_MAX_ATTEMPTS_PER_HOUR: positiveIntWithDefault("OTP_IP_MAX_ATTEMPTS_PER_HOUR"),
  OTP_VERIFY_MAX_ATTEMPTS_PER_MINUTE: positiveIntWithDefault("OTP_VERIFY_MAX_ATTEMPTS_PER_MINUTE"),
  SESSION_MAX_AGE_DAYS: positiveIntWithDefault("SESSION_MAX_AGE_DAYS"),
  MAX_INPUT_PIXELS: positiveIntWithDefault("MAX_INPUT_PIXELS"),
  MAX_IMAGE_QUALITY: z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .int("MAX_IMAGE_QUALITY must be an integer")
      .min(1, "MAX_IMAGE_QUALITY must be between 1 and 100")
      .max(100, "MAX_IMAGE_QUALITY must be between 1 and 100")
      .default(Number.parseInt(getDefaultString("MAX_IMAGE_QUALITY"), 10))
  ),
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
  PROCESSING_RECOVERY_MAX_BATCH: positiveIntWithDefault("PROCESSING_RECOVERY_MAX_BATCH"),
  PROCESSING_RECOVERY_MAX_ATTEMPTS: positiveIntWithDefault("PROCESSING_RECOVERY_MAX_ATTEMPTS"),
  PROCESSING_RECOVERY_COOLDOWN_SECONDS: positiveIntWithDefault(
    "PROCESSING_RECOVERY_COOLDOWN_SECONDS"
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
