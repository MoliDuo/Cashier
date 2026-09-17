import { getStartupEnvValue } from "./startup";

export interface RuntimeEnv {
  readonly databaseUrl: string;
  readonly apiKeyPepper: string;
  readonly rateLimitPepper: string;
  readonly openaiApiKey: string;
  readonly openaiBaseUrl: string;
  readonly hasOpenaiBaseUrl: boolean;
  readonly appUrl: string;
  readonly authResendKey: string | undefined;
  readonly authEmailFrom: string;
  readonly authOtpPepper: string;
  readonly s3Endpoint: string;
  readonly s3PublicEndpoint: string | undefined;
  readonly s3Region: string;
  readonly s3Bucket: string;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly s3ForcePathStyle: boolean;
  readonly trustedProxy: string | undefined;
  readonly timeZone: string;
  readonly aiModel: string;
  readonly aiMaxRetries: number;
  readonly aiRetryDelayMs: number;
  readonly aiRequestTimeoutMs: number;
  readonly aiRevisionDeadlineMs: number;
  readonly aiCategoryConcurrency: number;
  readonly aiCategoryRequestTimeoutMs: number;
  readonly aiCategoryMaxAttempts: number;
  readonly uploadPlanLimitPer15Min: number;
  readonly uploadOpenSessionLimit: number;
  readonly uploadDailyBytesLimit: number;
  readonly aiTemperature: number;
  readonly sourceDocStaleTimeMs: number;
  readonly currencyStaleTimeMs: number;
  readonly otpExpiresSeconds: number;
  readonly otpLockoutMinutes: number;
  readonly otpMaxAttempts: number;
  readonly otpResendCooldownSeconds: number;
  readonly authRateLimitMax: number;
  readonly authRateLimitWindow: number;
  readonly authPasswordEmailMaxAttempts: number;
  readonly authPasswordIpMaxAttempts: number;
  readonly authPasswordRateLimitWindowSeconds: number;
  readonly otpIpMaxAttemptsPerHour: number;
  readonly otpVerifyMaxAttemptsPerMinute: number;
  readonly apiRateLimitPerMinute: number;
  readonly sessionMaxAgeDays: number;
  readonly maxInputPixels: number;
  readonly maxImageQuality: number;
  readonly databasePoolMax: number;
  readonly logLevel: string;
  readonly devAuthBypass: boolean;
  readonly processingRecoveryMaxBatch: number;
  readonly processingRecoveryMaxAttempts: number;
  readonly processingRecoveryCooldownSeconds: number;
}

function hasExplicitValue(name: string): boolean {
  const value = process.env[name];
  return value != null && value.trim() !== "";
}

// Use getters so tests can override process.env without reloading every consumer.
export const runtimeEnv: RuntimeEnv = {
  get databaseUrl() {
    return getStartupEnvValue("DATABASE_URL");
  },
  get apiKeyPepper() {
    return getStartupEnvValue("API_KEY_PEPPER");
  },
  get rateLimitPepper() {
    return getStartupEnvValue("RATE_LIMIT_PEPPER");
  },
  get openaiApiKey() {
    return getStartupEnvValue("OPENAI_API_KEY");
  },
  get openaiBaseUrl() {
    return getStartupEnvValue("OPENAI_BASE_URL");
  },
  get hasOpenaiBaseUrl() {
    return hasExplicitValue("OPENAI_BASE_URL");
  },
  get appUrl() {
    return getStartupEnvValue("APP_URL");
  },
  get authResendKey() {
    return getStartupEnvValue("AUTH_RESEND_KEY");
  },
  get authEmailFrom() {
    return getStartupEnvValue("AUTH_EMAIL_FROM");
  },
  get authOtpPepper() {
    return getStartupEnvValue("AUTH_OTP_PEPPER");
  },
  get s3Endpoint() {
    return getStartupEnvValue("S3_ENDPOINT");
  },
  get s3PublicEndpoint() {
    return getStartupEnvValue("S3_PUBLIC_ENDPOINT");
  },
  get s3Region() {
    return getStartupEnvValue("S3_REGION");
  },
  get s3Bucket() {
    return getStartupEnvValue("S3_BUCKET");
  },
  get s3AccessKeyId() {
    return getStartupEnvValue("S3_ACCESS_KEY_ID");
  },
  get s3SecretAccessKey() {
    return getStartupEnvValue("S3_SECRET_ACCESS_KEY");
  },
  get s3ForcePathStyle() {
    return getStartupEnvValue("S3_FORCE_PATH_STYLE") === "true";
  },
  get trustedProxy() {
    return getStartupEnvValue("TRUSTED_PROXY");
  },
  get timeZone() {
    return getStartupEnvValue("TZ");
  },
  get aiModel() {
    return getStartupEnvValue("AI_MODEL");
  },
  get aiMaxRetries() {
    return getStartupEnvValue("AI_MAX_RETRIES");
  },
  get aiRetryDelayMs() {
    return getStartupEnvValue("AI_RETRY_DELAY_MS");
  },
  get aiRequestTimeoutMs() {
    return getStartupEnvValue("AI_REQUEST_TIMEOUT_MS");
  },
  get aiRevisionDeadlineMs() {
    return getStartupEnvValue("AI_REVISION_DEADLINE_MS");
  },
  get aiCategoryConcurrency() {
    return getStartupEnvValue("AI_CATEGORY_CONCURRENCY");
  },
  get aiCategoryRequestTimeoutMs() {
    return getStartupEnvValue("AI_CATEGORY_REQUEST_TIMEOUT_MS");
  },
  get aiCategoryMaxAttempts() {
    return getStartupEnvValue("AI_CATEGORY_MAX_ATTEMPTS");
  },
  get uploadPlanLimitPer15Min() {
    return getStartupEnvValue("UPLOAD_PLAN_LIMIT_PER_15_MIN");
  },
  get uploadOpenSessionLimit() {
    return getStartupEnvValue("UPLOAD_OPEN_SESSION_LIMIT");
  },
  get uploadDailyBytesLimit() {
    return getStartupEnvValue("UPLOAD_DAILY_BYTES_LIMIT");
  },
  get aiTemperature() {
    return getStartupEnvValue("AI_TEMPERATURE");
  },
  get sourceDocStaleTimeMs() {
    return getStartupEnvValue("SOURCE_DOC_STALE_TIME_MS");
  },
  get currencyStaleTimeMs() {
    return getStartupEnvValue("CURRENCY_STALE_TIME_MS");
  },
  get otpExpiresSeconds() {
    return getStartupEnvValue("OTP_EXPIRES_SECONDS");
  },
  get otpLockoutMinutes() {
    return getStartupEnvValue("OTP_LOCKOUT_MINUTES");
  },
  get otpMaxAttempts() {
    return getStartupEnvValue("OTP_MAX_ATTEMPTS");
  },
  get otpResendCooldownSeconds() {
    return getStartupEnvValue("OTP_RESEND_COOLDOWN_SECONDS");
  },
  get authRateLimitMax() {
    return getStartupEnvValue("AUTH_RATE_LIMIT_MAX");
  },
  get authRateLimitWindow() {
    return getStartupEnvValue("AUTH_RATE_LIMIT_WINDOW");
  },
  get authPasswordEmailMaxAttempts() {
    return getStartupEnvValue("AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS");
  },
  get authPasswordIpMaxAttempts() {
    return getStartupEnvValue("AUTH_PASSWORD_IP_MAX_ATTEMPTS");
  },
  get authPasswordRateLimitWindowSeconds() {
    return getStartupEnvValue("AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS");
  },
  get otpIpMaxAttemptsPerHour() {
    return getStartupEnvValue("OTP_IP_MAX_ATTEMPTS_PER_HOUR");
  },
  get otpVerifyMaxAttemptsPerMinute() {
    return getStartupEnvValue("OTP_VERIFY_MAX_ATTEMPTS_PER_MINUTE");
  },
  get apiRateLimitPerMinute() {
    return getStartupEnvValue("API_RATE_LIMIT_PER_MINUTE");
  },
  get sessionMaxAgeDays() {
    return getStartupEnvValue("SESSION_MAX_AGE_DAYS");
  },
  get maxInputPixels() {
    return getStartupEnvValue("MAX_INPUT_PIXELS");
  },
  get maxImageQuality() {
    return getStartupEnvValue("MAX_IMAGE_QUALITY");
  },
  get databasePoolMax() {
    return getStartupEnvValue("DATABASE_POOL_MAX");
  },
  get logLevel() {
    return getStartupEnvValue("LOG_LEVEL");
  },
  get devAuthBypass() {
    return getStartupEnvValue("DEV_AUTH_BYPASS") === "true";
  },
  get processingRecoveryMaxBatch() {
    return getStartupEnvValue("PROCESSING_RECOVERY_MAX_BATCH");
  },
  get processingRecoveryMaxAttempts() {
    return getStartupEnvValue("PROCESSING_RECOVERY_MAX_ATTEMPTS");
  },
  get processingRecoveryCooldownSeconds() {
    return getStartupEnvValue("PROCESSING_RECOVERY_COOLDOWN_SECONDS");
  },
};
