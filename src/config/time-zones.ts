/**
 * The zones the ledger can be read in — a short list rather than every IANA
 * name. A ledger already set to one outside it keeps that zone as an option.
 */
export const LEDGER_TIME_ZONES = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
] as const;
