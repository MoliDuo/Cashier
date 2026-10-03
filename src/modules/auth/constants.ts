/**
 * The cookie that carries the session token; the proxy only checks it is present. The `__Host-`
 * prefix makes browsers require Secure and Path=/ and refuse a Domain, so it is always set Secure
 * (browsers accept that on http://localhost too).
 */
export const SESSION_COOKIE_NAME = "__Host-cashier_session";

/**
 * Left for a minute by sign-out. The login page reads it as "this person just
 * left", so a stray navigation to it does not send them straight back in.
 */
export const SIGNED_OUT_COOKIE_NAME = "cashier_signed_out";
