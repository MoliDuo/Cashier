/** The cookie that carries the session token; the proxy only checks it is present. */
export const SESSION_COOKIE_NAME = "cashier_session";

/**
 * Left for a minute by sign-out. The login page reads it as "this person just
 * left", so a stray navigation to it does not send them straight back in.
 */
export const SIGNED_OUT_COOKIE_NAME = "cashier_signed_out";
