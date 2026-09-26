export const TEST_DATABASE_PLACEHOLDER = "postgresql://cashier:cashier@127.0.0.1:1/cashier_test";

export const TEST_STARTUP_ENV = Object.freeze({
  DATABASE_URL: TEST_DATABASE_PLACEHOLDER,
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_BASE_URL: "",
  AUTH_SECRET: "test-auth-secret",
  APP_URL: "http://localhost:3000",
  AUTH_RESEND_KEY: "test-resend-key",
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
  LOG_LEVEL: "",
  DEV_AUTH_BYPASS: "",
  DATABASE_POOL_MAX: "",
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
