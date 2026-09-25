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

/**
 * The `maxDuration` every AI-running route exports. Route segment config has
 * to be a literal, so the routes repeat the number and a unit test holds them
 * to this one. Every deadline and run budget below must fit inside it.
 */
export const FUNCTION_MAX_DURATION_SECONDS = 120;
const FUNCTION_BUDGET_MS = FUNCTION_MAX_DURATION_SECONDS * 1000;
/** Kept free at the end of a run for writing down how it ended. */
export const OUTCOME_RESERVE_MS = 10_000;

/**
 * Background leases. A worker renews its lease on every heartbeat; a lease
 * lasts several heartbeats so one slow renewal does not lose it, and only
 * decides how soon work whose function was killed can be claimed again.
 */
export const LEASE_HEARTBEAT_MS = FUNCTION_BUDGET_MS / 8;
export const LEASE_DURATION_MS = 4 * LEASE_HEARTBEAT_MS;
/** How long the daily cron keeps starting new maintenance work. */
export const CRON_BUDGET_MS = FUNCTION_BUDGET_MS - OUTCOME_RESERVE_MS;
/** Runs one piece of background work gets, the first one included, before it is failed. */
export const BACKGROUND_MAX_ATTEMPTS = 3;

/** OpenAI calls: how long to wait, how often to try again. */
export const AI_REQUEST_TIMEOUT_MS = 60_000;
export const AI_MAX_ATTEMPTS = 3;
/**
 * Base for the randomized backoff between attempts. Zero under test: there is
 * no provider there to be polite to, and a real backoff eats the `after()`
 * budget an integration test waits on.
 */
export const AI_RETRY_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 1_000;
/**
 * The whole parse of one source document, across however many model calls.
 * Leaves room inside the function limit for the request that scheduled the
 * parse and for recording the outcome, so a slow parse fails as
 * `processing_timeout` instead of being killed and retried from scratch.
 */
export const AI_REVISION_DEADLINE_MS = FUNCTION_BUDGET_MS - 3 * OUTCOME_RESERVE_MS;

export const AI_CATEGORY_REQUEST_TIMEOUT_MS = 60_000;
/** The most entries one category assignment can be started over. */
export const CATEGORY_ASSIGNMENT_MAX_ENTRIES = 5000;
/**
 * How long one run keeps starting model requests. A request started at the
 * last moment still has its timeout plus a margin before the function limit;
 * whatever is left is picked up by the next run.
 */
export const CATEGORY_RUN_BUDGET_MS =
  FUNCTION_BUDGET_MS - AI_CATEGORY_REQUEST_TIMEOUT_MS - OUTCOME_RESERVE_MS;

/**
 * Upload ceilings, per ledger: files planned but not yet finalized, and bytes
 * stored since UTC midnight (100 MiB).
 */
export const UPLOAD_PENDING_FILE_LIMIT = 20;
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
