import { isValidTimeZone } from "./date-utils";

/**
 * The browser's own zone, carried to the server so a prefetch can date the same
 * day the device will. A book's `time_zone` still wins; this is the answer for
 * a book that has none, which is also what an API upload never has — an upload
 * has no device and dates in the server's zone.
 */
export const DEVICE_TIME_ZONE_COOKIE = "CASHIER_TIME_ZONE";

const DEVICE_TIME_ZONE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Serializes the device zone into the Set-Cookie value `document.cookie` takes. */
export function buildDeviceTimeZoneCookie(timeZone: string): string {
  return `${DEVICE_TIME_ZONE_COOKIE}=${timeZone}; path=/; max-age=${DEVICE_TIME_ZONE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * The zone a cookie value holds, or null when it is absent or malformed. The
 * cookie is external input wherever it is read, so a forged zone is ignored
 * rather than handed to the date formatters.
 */
export function parseDeviceTimeZoneCookie(value: string | null | undefined): string | null {
  if (value == null || value === "" || !isValidTimeZone(value)) return null;
  return value;
}

/**
 * The browser's own zone, or null where there is no browser (a server render).
 * It is what a book with no zone of its own dates by on the web.
 */
export function getDeviceTimeZone(): string | null {
  if (typeof Intl === "undefined") return null;
  return parseDeviceTimeZoneCookie(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * Writes the resolved device zone where the server can read it. Client only;
 * the cookie is what keeps a server prefetch on the same day as the tab.
 */
export function writeDeviceTimeZoneCookie(timeZone: string): void {
  document.cookie = buildDeviceTimeZoneCookie(timeZone);
}

/**
 * The zone a server-rendered read dates in, in order: the viewed book's own
 * zone, then the device zone the browser reported, then the deployment's `TZ`.
 */
export function resolveRequestTimeZone(input: {
  bookTimeZone?: string | null | undefined;
  deviceTimeZone?: string | null | undefined;
  fallbackTimeZone: string;
}): string {
  if (input.bookTimeZone != null && input.bookTimeZone !== "") return input.bookTimeZone;
  if (input.deviceTimeZone != null && input.deviceTimeZone !== "") return input.deviceTimeZone;
  return input.fallbackTimeZone;
}
