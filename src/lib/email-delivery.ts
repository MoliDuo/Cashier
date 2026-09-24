import "server-only";
import type { ReactElement } from "react";
import { runtimeEnv } from "@/lib/env/runtime";

/** Sends one email through Resend; `not_configured` when no API key is set. */
export async function sendEmail(input: {
  from: string;
  to: string;
  subject: string;
  content: ReactElement;
}): Promise<"sent" | "not_configured"> {
  const apiKey = runtimeEnv.authResendKey;
  if (apiKey == null || apiKey === "") return "not_configured";
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from: input.from,
    to: input.to,
    subject: input.subject,
    react: input.content,
  });
  if (result.error != null || result.data?.id == null || result.data.id === "") {
    throw new Error("Email provider did not accept the message");
  }
  return "sent";
}
