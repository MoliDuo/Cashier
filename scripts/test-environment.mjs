export const TEST_DATABASE_PLACEHOLDER = "postgresql://cashier:cashier@127.0.0.1:1/cashier_test";

export const TEST_STARTUP_ENV = Object.freeze({
  DATABASE_URL: TEST_DATABASE_PLACEHOLDER,
  API_KEY_PEPPER: "test-pepper-for-testing-only",
  RATE_LIMIT_PEPPER: "test-rate-limit-pepper",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_BASE_URL: "",
  AUTH_SECRET: "test-auth-secret",
  APP_URL: "http://localhost:3000",
  AUTH_RESEND_KEY: "test-resend-key",
  AUTH_OTP_PEPPER: "test-auth-otp-pepper",
  AUTH_EMAIL_FROM: "",
  S3_ENDPOINT: "http://127.0.0.1:1",
  S3_PUBLIC_ENDPOINT: "",
  S3_REGION: "",
  S3_BUCKET: "cashier-test-images",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
  S3_FORCE_PATH_STYLE: "",
  TRUSTED_PROXY: "",
  TZ: "",
  AI_MODEL: "test-model",
  AI_MAX_RETRIES: "",
  // Exercise retries without randomized production backoff consuming the after() budget.
  AI_RETRY_DELAY_MS: "0",
  AI_REQUEST_TIMEOUT_MS: "",
  AI_REVISION_DEADLINE_MS: "",
  UPLOAD_PLAN_LIMIT_PER_15_MIN: "",
  UPLOAD_OPEN_SESSION_LIMIT: "",
  UPLOAD_DAILY_BYTES_LIMIT: "",
  AI_TEMPERATURE: "",
  SOURCE_DOC_STALE_TIME_MS: "",
  CURRENCY_STALE_TIME_MS: "",
  OTP_EXPIRES_SECONDS: "",
  OTP_LOCKOUT_MINUTES: "",
  OTP_MAX_ATTEMPTS: "",
  OTP_RESEND_COOLDOWN_SECONDS: "",
  AUTH_RATE_LIMIT_MAX: "",
  AUTH_RATE_LIMIT_WINDOW: "",
  AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS: "",
  AUTH_PASSWORD_IP_MAX_ATTEMPTS: "",
  AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS: "",
  API_RATE_LIMIT_PER_MINUTE: "",
  OTP_IP_MAX_ATTEMPTS_PER_HOUR: "",
  OTP_VERIFY_MAX_ATTEMPTS_PER_MINUTE: "",
  SESSION_MAX_AGE_DAYS: "",
  MAX_INPUT_PIXELS: "",
  MAX_IMAGE_QUALITY: "",
  LOG_LEVEL: "",
  DEV_AUTH_BYPASS: "",
  DATABASE_POOL_MAX: "",
  PROCESSING_RECOVERY_MAX_BATCH: "",
  PROCESSING_RECOVERY_MAX_ATTEMPTS: "",
  PROCESSING_RECOVERY_COOLDOWN_SECONDS: "",
});

export function createTestEnvironment(baseEnvironment = process.env, overrides = {}) {
  return {
    ...baseEnvironment,
    ...TEST_STARTUP_ENV,
    NODE_ENV: "test",
    ...overrides,
  };
}

export function installTestEnvironment(environment = process.env, overrides = {}) {
  Object.assign(environment, TEST_STARTUP_ENV, { NODE_ENV: "test" }, overrides);
  return environment;
}
