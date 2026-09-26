/**
 * The email provider the production smoke run sends through.
 *
 * `npm run test:smoke` runs a production build, where `process.env.NODE_ENV` is
 * compiled in as "production", so no test-only branch inside the app could hand
 * a spec the code it sent. The Resend SDK reads `RESEND_BASE_URL` when it is
 * called instead, so the run points it here: the real send path renders and
 * posts the email, and this endpoint keeps it in memory for the life of the run.
 *
 * `POST /emails` is the one Resend call the application makes. `GET /outbox`
 * answers the newest message to `?to=` with the code it carries, so a spec can
 * sign in with it. Requests are not authenticated — the endpoint exists only on
 * loopback and only while the smoke run is up — and nothing is logged, since
 * what passes through is a working sign-in code.
 */

import { randomUUID } from "node:crypto";
import http from "node:http";

/** The part of a Resend send request the outbox reads. */
export interface SmokeEmail {
  to?: unknown;
  subject?: string;
  html?: unknown;
}

interface StoredEmail {
  id: string;
  to: string[];
  subject: string | undefined;
  html: string;
}

/** The newest message to an address, as `GET /outbox` answers it. */
export interface OutboxMessage {
  subject: string | undefined;
  code: string | null;
}

export interface SmokeOutbox {
  add(email: SmokeEmail & { html: string }): string;
  latestTo(address: string): OutboxMessage | null;
}

/** What `POST /emails` answers: a status and Resend's JSON body. */
export interface EmailResponse {
  status: number;
  body: { id: string } | { name: string; message: string };
}

/** The code in an OTP email: the one text node that is exactly six digits. */
export function codeFromHtml(html: string): string | null {
  return />\s*(\d{6})\s*</.exec(html)?.[1] ?? null;
}

export function createSmokeOutbox(): SmokeOutbox {
  const messages: StoredEmail[] = [];
  return {
    add({ to, subject, html }) {
      const recipients = (Array.isArray(to) ? to : [to]).map((address: unknown) =>
        String(address).toLowerCase()
      );
      const id = randomUUID();
      messages.push({ id, to: recipients, subject, html });
      return id;
    },
    latestTo(address) {
      const wanted = address.toLowerCase();
      const message = messages.findLast((candidate) => candidate.to.includes(wanted));
      if (message == null) return null;
      return { subject: message.subject, code: codeFromHtml(message.html) };
    },
  };
}

/** What `POST /emails` answers for one request body: Resend's `{ id }`, or its error shape. */
export function acceptEmail(outbox: SmokeOutbox, email: SmokeEmail | null): EmailResponse {
  if (email?.to == null || typeof email.html !== "string") {
    return { status: 422, body: { name: "validation_error", message: "to and html are required" } };
  }
  return { status: 200, body: { id: outbox.add({ ...email, html: email.html }) } };
}

/**
 * A running, empty outbox. Listen on the returned server and point
 * `RESEND_BASE_URL` at `http://127.0.0.1:<port>`.
 */
export function createSmokeEmailServer({
  outbox = createSmokeOutbox(),
}: { outbox?: SmokeOutbox } = {}): http.Server {
  const sendJson = (response: http.ServerResponse, status: number, body: object) => {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": String(payload.length),
    });
    response.end(payload);
  };

  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (request.method === "POST" && url.pathname === "/emails") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk);
        const { status, body } = acceptEmail(
          outbox,
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as SmokeEmail | null
        );
        sendJson(response, status, body);
        return;
      }
      if (request.method === "GET" && url.pathname === "/outbox") {
        const message = outbox.latestTo(url.searchParams.get("to") ?? "");
        if (message == null) sendJson(response, 404, { message: "No email to that address" });
        else sendJson(response, 200, message);
        return;
      }
      sendJson(response, 404, {
        name: "not_found",
        message: "Not implemented by the smoke outbox",
      });
    } catch {
      sendJson(response, 400, { name: "invalid_request", message: "Unreadable request" });
    }
  });
}
