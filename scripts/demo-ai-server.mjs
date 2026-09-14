/**
 * The AI provider the demo workspace talks to.
 *
 * The demo stack points OPENAI_BASE_URL here instead of at a real provider, so
 * the whole processing pipeline runs for real — 处理中 → 已完成, retry, cancel,
 * and the failure branches — without a network call or a paid key. Nothing in
 * the application knows about it: this is a provider, not a mode.
 *
 * Which scenario a request gets is named by a `demo:<name>` token that the
 * ledger's own AI custom prompt (设置 → AI) or a typed document text carries.
 * Every scenario is one lookup in SCENARIOS below.
 */

import http from "node:http";

const DEFAULT_LATENCY_MS = 1500;
const DEFAULT_SLOW_MS = 5 * 60 * 1000;
const DEFAULT_SCENARIO = "success";

/** The `demo:<name>` token a custom prompt or a document text can carry. */
const SCENARIO_TOKEN = /demo:([a-z0-9-]+)/i;

/** One expense line, in the shape the app's parser schema accepts. */
function entry(itemName, amount, currency, notes = null) {
  return {
    receipt_index: 0,
    item_name: itemName,
    amount,
    currency,
    category_index: 1,
    notes,
    date_hint: null,
  };
}

/** A parse the app's own schema accepts, with one receipt and no adjustments. */
function parsedBody({ title, entries, reasoning }) {
  return {
    outcome: "success",
    invalid_reason: null,
    title,
    receipt_count: 1,
    receipt_totals: [],
    ledger_entries: entries,
    order_adjustments: [],
    reasoning,
  };
}

/**
 * Every answer the stub can give. A scenario returns either a parse body, or an
 * HTTP failure to answer with; `delayMs` defaults to the server's own latency.
 */
const SCENARIOS = {
  /** A normal parse: the card goes 处理中 → 已完成 with real entries. */
  success: () => ({
    body: parsedBody({
      title: "Demo Receipt",
      entries: [entry("Demo line item", "12.34", "CNY")],
      reasoning: "One priced line item on the document.",
    }),
  }),

  /** The same parse held open, so 处理中 stays on screen long enough to study. */
  slow: ({ slowMs }) => ({
    body: parsedBody({
      title: "Demo Slow Receipt",
      entries: [entry("Demo slow line item", "45.60", "CNY")],
      reasoning: "One priced line item on the document.",
    }),
    delayMs: slowMs,
  }),

  /** A foreign-currency parse, converted from the demo's own offline rate snapshot. */
  foreign: () => ({
    body: parsedBody({
      title: "Demo Foreign Purchase",
      entries: [entry("Overseas order", "18.50", "USD")],
      reasoning: "One priced line item, charged in US dollars.",
    }),
  }),

  /** A document the AI reads but cannot turn into an expense, with its own reason. */
  unparsable: () => ({
    body: {
      outcome: "invalid",
      invalid_reason: "The document shows no price tied to a single transaction.",
      title: "Demo Unreadable Document",
      receipt_count: 0,
      receipt_totals: [],
      ledger_entries: [],
      order_adjustments: [],
      reasoning: "Only a balance and a price range are visible.",
    },
  }),

  /**
   * Valid JSON that violates the parser schema — an amount sent as a JSON number
   * instead of a quoted decimal string. Returning malformed JSON instead would be
   * caught by the JSON repair path and surface as a provider failure, not as the
   * schema failure this scenario exists to show.
   */
  "schema-invalid": () => ({
    body: {
      outcome: "success",
      invalid_reason: null,
      title: "Demo Malformed Parse",
      receipt_count: 1,
      receipt_totals: [],
      ledger_entries: [
        {
          receipt_index: 0,
          item_name: "Malformed amount",
          amount: 18.5,
          currency: "CNY",
          category_index: 1,
          notes: null,
          date_hint: null,
        },
      ],
      order_adjustments: [],
      reasoning: "Amount was emitted without quotes.",
    },
  }),

  /** The provider itself refusing, the way an outage would look. */
  "provider-error": () => ({
    status: 503,
    error: { message: "Demo AI provider outage", type: "server_error" },
  }),
};

export const DEMO_AI_SCENARIOS = Object.keys(SCENARIOS);

/** @testOnly The scenario name a prompt asks for, or null when it asks for none. */
export function readScenarioToken(prompt) {
  const match = SCENARIO_TOKEN.exec(prompt);
  return match == null ? null : match[1].toLowerCase();
}

/** @testOnly The scenario a prompt resolves to: its own request, or the default. */
export function selectScenario(prompt) {
  const requested = readScenarioToken(prompt);
  return requested != null && Object.hasOwn(SCENARIOS, requested) ? requested : DEFAULT_SCENARIO;
}

/**
 * @testOnly What the stub answers a given prompt, decided without any HTTP so
 * the scenarios can be checked against the application's own parser schema.
 */
export function answerFor(
  prompt,
  { slowMs = DEFAULT_SLOW_MS, latencyMs = DEFAULT_LATENCY_MS } = {}
) {
  const requested = readScenarioToken(prompt);
  const scenario = selectScenario(prompt);
  const answer = SCENARIOS[scenario]({ slowMs });
  return {
    scenario,
    requested,
    delayMs: answer.delayMs ?? latencyMs,
    ...(answer.status == null ? {} : { status: answer.status, error: answer.error }),
    ...(answer.body == null ? {} : { body: answer.body }),
  };
}

/** @testOnly The chat-completion envelope the app's OpenAI client reads. */
export function chatCompletionEnvelope(payload, content) {
  return {
    id: "chatcmpl-demo",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: payload.model ?? "demo",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function promptOf(payload) {
  return (payload.messages ?? [])
    .flatMap((message) =>
      typeof message.content === "string"
        ? [message.content]
        : (message.content ?? [])
            .filter((part) => part.type === "text" && typeof part.text === "string")
            .map((part) => part.text)
    )
    .join("\n");
}

function categoryAssignmentBody(prompt, scenario) {
  if (!prompt.includes("You are an expense categorizer")) return null;
  if (scenario === "schema-invalid") {
    return { decisions: [{ entry_index: 1, category_index: 0 }] };
  }
  const entries = prompt.split("### Expense Entries")[1] ?? "";
  const count = entries.split("\n").filter((line) => /^\d+\. item_name:/.test(line)).length;
  return {
    decisions: Array.from({ length: count }, (_, index) => ({
      entry_index: index + 1,
      category_index: 1,
    })),
  };
}

async function respond(request, response, options) {
  if (request.method !== "POST" || request.url?.endsWith("/chat/completions") !== true) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ error: { message: "The demo AI serves POST /v1/chat/completions only." } })
    );
    return;
  }

  const payload = JSON.parse((await readBody(request)) || "{}");
  const prompt = promptOf(payload);
  const answer = answerFor(prompt, options);
  const assignmentBody = categoryAssignmentBody(prompt, answer.scenario);

  options.log(
    `[demo-ai] scenario=${answer.scenario}` +
      (answer.requested != null && answer.requested !== answer.scenario
        ? ` (ignored unknown demo:${answer.requested})`
        : "") +
      (answer.delayMs > 0 ? ` holding ${Math.round(answer.delayMs / 1000)}s` : "")
  );

  if (answer.delayMs > 0) await sleep(answer.delayMs);

  if (answer.status != null) {
    response.writeHead(answer.status, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: answer.error }));
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify(chatCompletionEnvelope(payload, JSON.stringify(assignmentBody ?? answer.body)))
  );
}

export function createDemoAiServer({
  slowMs = DEFAULT_SLOW_MS,
  latencyMs = DEFAULT_LATENCY_MS,
  log = () => {},
} = {}) {
  return http.createServer((request, response) => {
    respond(request, response, { slowMs, latencyMs, log }).catch((error) => {
      log(`[demo-ai] request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.writableEnded) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "The demo AI stub failed." } }));
      }
    });
  });
}
