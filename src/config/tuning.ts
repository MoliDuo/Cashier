/**
 * Numbers that used to be environment variables.
 *
 * Every one of them shipped as a knob so that somebody else's deployment could
 * turn it — 30 variables, each with a Zod rule, a line in `.env.example`, a row
 * in the configuration table, and a default that no deployment has ever
 * overridden. There is one deployment. Changing a number here and pushing is
 * the same act as changing it in a dashboard and redeploying, minus the four
 * places that had to agree about what the number was allowed to be.
 *
 * What stayed in the environment is what genuinely differs between running this
 * on a laptop and running it on Vercel: connection strings, credentials, the
 * bucket, the public URL, and the two switches that change behaviour rather
 * than degree.
 */

/** OpenAI calls: how long to wait, how often to try again. */
export const AI_REQUEST_TIMEOUT_MS = 60_000;
export const AI_MAX_ATTEMPTS = 3;
/**
 * Base for the randomized backoff between attempts. Zero under test: there is
 * no provider there to be polite to, and a real backoff eats the `after()`
 * budget an integration test waits on.
 */
export const AI_RETRY_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 1_000;
/** The whole parse of one source document, across however many model calls. */
export const AI_REVISION_DEADLINE_MS = 180_000;

/** Bulk re-categorisation shares one database-coordinated provider slot. */
export const AI_CATEGORY_CONCURRENCY = 1;
export const AI_CATEGORY_REQUEST_TIMEOUT_MS = 60_000;
export const AI_CATEGORY_MAX_ATTEMPTS = 3;

/** Upload ceilings, per ledger. The daily one is 100 MiB. */
export const UPLOAD_PLAN_LIMIT_PER_15_MIN = 20;
export const UPLOAD_OPEN_SESSION_LIMIT = 5;
export const UPLOAD_DAILY_BYTES_LIMIT = 104_857_600;

/** JPEG quality for a normalised receipt photo. */
export const MAX_IMAGE_QUALITY = 85;

/** How long the client treats a fetched source document as fresh. */
export const SOURCE_DOC_STALE_TIME_MS = 120_000;

/** One-time codes: lifetime, and what happens when they are guessed at. */
export const OTP_EXPIRES_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCKOUT_MINUTES = 15;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Sending a code: per address, and per address per hour. */
export const AUTH_RATE_LIMIT_MAX = 10;
export const AUTH_RATE_LIMIT_WINDOW_SECONDS = 900;
export const OTP_IP_MAX_ATTEMPTS_PER_HOUR = 10;
export const OTP_VERIFY_MAX_ATTEMPTS_PER_MINUTE = 5;

/** Password sign-in, per address and per IP, over the same window. */
export const AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS = 10;
export const AUTH_PASSWORD_IP_MAX_ATTEMPTS = 50;
export const AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS = 900;

/** API v1, per credential. */
export const API_RATE_LIMIT_PER_MINUTE = 60;

/** How long a signed-in session survives without being renewed. */
export const SESSION_MAX_AGE_DAYS = 14;

/** Picking up source documents whose processing died mid-flight. */
export const PROCESSING_RECOVERY_MAX_BATCH = 5;
export const PROCESSING_RECOVERY_MAX_ATTEMPTS = 5;
export const PROCESSING_RECOVERY_COOLDOWN_SECONDS = 60;
