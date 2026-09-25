import { createHmac } from "node:crypto";
import { runtimeEnv } from "@/lib/env/runtime";

/**
 * Two kinds of identifier end up in a log line, and they want opposite things.
 *
 * An email address or an IP is personal data: it is pseudonymised, because a
 * log is read by more eyes and kept for longer than the table it came from.
 * Everything else is an internal surrogate key — it identifies a row and
 * nothing about a person. Digesting those bought nothing and cost the only
 * thing a log is for: a production error used to name a source document that
 * could not then be found in the database.
 */
const PERSONAL_KINDS = ["email", "ip"] as const;

export type LogIdentifierKind =
  | (typeof PERSONAL_KINDS)[number]
  | "user"
  | "ledger"
  | "source-document"
  | "revision"
  | "stored-file"
  | "processing-job";

export function logIdentifier(kind: LogIdentifierKind, value: string): string {
  if (!(PERSONAL_KINDS as readonly string[]).includes(kind)) return `${kind}:${value}`;
  const digest = createHmac("sha256", runtimeEnv.apiKeyPepper)
    .update(value.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return `${kind}:${digest}`;
}
