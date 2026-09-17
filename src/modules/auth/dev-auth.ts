export const DEV_AUTH_EMAIL = "dev@cashier.local";

export function isDevAuthBypassEnabled(): boolean {
  if (process.env.DEV_AUTH_BYPASS !== "true") return false;
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.NODE_ENV !== "development") return false;
  try {
    const hostname = new URL(process.env.APP_URL ?? "").hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
