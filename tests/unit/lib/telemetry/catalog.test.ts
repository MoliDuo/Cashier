import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Condition = { prop: string; op: string; value?: unknown };
type Catalog = {
  schemaVersion: number;
  events: {
    name: string;
    description: string;
    tier?: string;
    props?: Record<string, { type: string; description: string; enum?: unknown[] }>;
  }[];
  metrics: {
    name: string;
    kind: string;
    numerator: { event: string; where?: Condition[] };
    denominator: { event: string; where?: Condition[] };
    goodDirection?: string;
  }[];
  funnels: { name: string; steps: { event: string }[]; windowMs: number }[];
};

const root = process.cwd();
const catalog = JSON.parse(readFileSync(join(root, "telemetry-catalog.json"), "utf8")) as Catalog;
const eventsSource = readFileSync(join(root, "src/lib/telemetry/events.ts"), "utf8");

/** The keys of the two event maps in `events.ts`, e.g. `"record.open"` or `$error`. */
function declaredEventNames(): string[] {
  const names = new Set<string>();
  for (const match of eventsSource.matchAll(/^ {2}(?:"([^"]+)"|(\$[A-Za-z]+)): \{/gm)) {
    names.add((match[1] ?? match[2])!);
  }
  return [...names];
}

/** The prop names an event declares in `events.ts`. */
function declaredProps(event: string): string[] {
  const escaped = event.replace(/\$/g, "\\$");
  const start = eventsSource.search(new RegExp(`^ {2}(?:"${escaped}"|${escaped}): \\{`, "m"));
  expect(start).toBeGreaterThanOrEqual(0);
  const open = eventsSource.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < eventsSource.length; end += 1) {
    if (eventsSource[end] === "{") depth += 1;
    if (eventsSource[end] === "}") depth -= 1;
    if (depth === 0) break;
  }
  const body = eventsSource.slice(open + 1, end);
  return [...body.matchAll(/(?:^|[;{,\s])([A-Za-z]+)\??:/g)].map((m) => m[1]!);
}

describe("telemetry-catalog.json", () => {
  const catalogNames = catalog.events.map((event) => event.name);

  it("describes exactly the events the code can send", () => {
    expect([...catalogNames].sort()).toEqual([...declaredEventNames()].sort());
  });

  it("lists each event once, with a description and a tier", () => {
    expect(new Set(catalogNames).size).toBe(catalogNames.length);
    for (const event of catalog.events) {
      expect(event.description.length, event.name).toBeGreaterThan(0);
      expect(["product", "debug"], event.name).toContain(event.tier);
    }
  });

  it("describes the props each event declares, and no others", () => {
    for (const event of catalog.events) {
      expect(Object.keys(event.props ?? {}).sort(), event.name).toEqual(
        [...new Set(declaredProps(event.name))].sort()
      );
    }
  });

  it("names metrics and funnels in snake_case and refers only to cataloged events", () => {
    const known = new Set(catalogNames);
    for (const metric of catalog.metrics) {
      expect(metric.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
      expect(known.has(metric.numerator.event), metric.name).toBe(true);
      expect(known.has(metric.denominator.event), metric.name).toBe(true);
    }
    for (const funnel of catalog.funnels) {
      expect(funnel.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
      for (const step of funnel.steps) expect(known.has(step.event), funnel.name).toBe(true);
    }
  });

  it("filters only on props the event declares", () => {
    const propsOf = new Map(catalog.events.map((event) => [event.name, event.props ?? {}]));
    const sides = catalog.metrics.flatMap((metric) => [metric.numerator, metric.denominator]);
    for (const { event, where } of sides) {
      for (const condition of where ?? []) {
        expect(propsOf.get(event), `${event}.${condition.prop}`).toHaveProperty(condition.prop);
      }
    }
  });

  it("defines the abandonment metric as record.abandon over record.open, lower is better", () => {
    const metric = catalog.metrics.find((m) => m.name === "record_abandon_rate");
    expect(metric).toMatchObject({
      kind: "ratio",
      numerator: { event: "record.abandon" },
      denominator: { event: "record.open" },
      goodDirection: "down",
    });
  });

  it("has the record flow funnel from open to an accepted submit", () => {
    const funnel = catalog.funnels.find((f) => f.name === "record_flow");
    expect(funnel?.steps.map((step) => step.event)).toEqual([
      "record.open",
      "record.submit",
      "record.result",
    ]);
  });
});
