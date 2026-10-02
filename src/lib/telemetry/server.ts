import "server-only";
import { createInsight, type Insight } from "@moli-insight/node";
import { runtimeEnv } from "@/lib/env/runtime";
import { logger } from "@/lib/logger";
import type { ServerEventMap, ServerEventName } from "./events";

/**
 * The server side of telemetry: the relay's client and the events the server
 * itself sends. With INSIGHT_URL or INSIGHT_KEY unset the instance is disabled,
 * the relay answers 204 and `sendServerEvent` does nothing, so the app runs the
 * same without a platform behind it.
 */

let cached: { url: string | undefined; key: string | undefined; insight: Insight } | undefined;

/** One instance per configuration; the values are read through the validated environment. */
export function getInsight(): Insight {
  const url = runtimeEnv.insightUrl;
  const key = runtimeEnv.insightKey;
  if (cached != null && cached.url === url && cached.key === key) return cached.insight;
  const insight = createInsight({
    ...(url == null ? {} : { url }),
    ...(key == null ? {} : { key }),
    onError: ({ status }) => {
      logger.warn({ status: status ?? null }, "Telemetry delivery failed");
    },
  });
  cached = { url, key, insight };
  return insight;
}

/**
 * Sends one server event without ever throwing or blocking the caller's work
 * past the SDK's own timeout. `correlationId` ties it to the browser event that
 * started the flow.
 */
export async function sendServerEvent<N extends ServerEventName>(
  name: N,
  props: ServerEventMap[N],
  correlationId?: string
): Promise<void> {
  try {
    await getInsight().send([{ name, props, ...(correlationId == null ? {} : { correlationId }) }]);
  } catch {
    // Telemetry is best effort, including a misconfigured INSIGHT_URL.
  }
}
