import { getStartupEnvValue } from "./startup";

export interface RuntimeEnv {
  readonly appUrl: string;
  readonly databaseUrl: string;
  readonly authSecret: string;
  readonly openaiApiKey: string;
  readonly openaiBaseUrl: string;
  readonly hasOpenaiBaseUrl: boolean;
  readonly authResendKey: string | undefined;
  readonly authEmailFrom: string;
  readonly s3Endpoint: string;
  readonly s3PublicEndpoint: string | undefined;
  readonly s3Region: string;
  readonly s3Bucket: string;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly s3ForcePathStyle: boolean;
  readonly trustedProxy: string | undefined;
  readonly cronSecret: string | undefined;
  readonly timeZone: string;
  readonly aiModel: string;
  readonly databasePoolMax: number;
}

function hasExplicitValue(name: string): boolean {
  const value = process.env[name];
  return value != null && value.trim() !== "";
}

// Use getters so tests can override process.env without reloading every consumer.
export const runtimeEnv: RuntimeEnv = {
  get appUrl() {
    return getStartupEnvValue("APP_URL");
  },
  get databaseUrl() {
    return getStartupEnvValue("DATABASE_URL");
  },
  get authSecret() {
    return getStartupEnvValue("AUTH_SECRET");
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
  get authResendKey() {
    return getStartupEnvValue("AUTH_RESEND_KEY");
  },
  get authEmailFrom() {
    return getStartupEnvValue("AUTH_EMAIL_FROM");
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
  get cronSecret() {
    return getStartupEnvValue("CRON_SECRET");
  },
  get timeZone() {
    return getStartupEnvValue("TZ");
  },
  get aiModel() {
    return getStartupEnvValue("AI_MODEL");
  },
  get databasePoolMax() {
    return getStartupEnvValue("DATABASE_POOL_MAX");
  },
};
