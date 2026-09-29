import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSummary, runCheck } from "../../../scripts/run-check";

interface FakeChild {
  script: string;
  child: ChildProcess;
  exit(code: number | null, signal?: NodeJS.Signals): void;
}

/** Stands in for `spawn`: records every child and lets the test end each one. */
function fakeSpawner() {
  const children: FakeChild[] = [];
  const spawnProcess = vi.fn((_command: string, args: string[]) => {
    const emitter = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(emitter, {
      stdout,
      stderr,
      killed: false,
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const script = args.at(-1)!;
    children.push({
      script,
      child,
      exit(code, signal) {
        stdout.end(`${script} output\n`);
        stderr.end();
        setImmediate(() => emitter.emit("close", code, signal ?? null));
      },
    });
    return child;
  });
  return { children, spawnProcess };
}

function running(children: FakeChild[]): string[] {
  return children.map(({ script }) => script);
}

/** Lets pending promise callbacks run so the runner can start its next stage. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("check runner", () => {
  it("runs a stage's scripts together and starts the next stage once all passed", async () => {
    const { children, spawnProcess } = fakeSpawner();
    const output: string[] = [];
    const result = runCheck({
      stages: [["lint", "tsc"], ["test:coverage"]],
      spawnProcess,
      write: (text) => output.push(text),
    });

    expect(running(children)).toEqual(["lint", "tsc"]);
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual(["run", "--silent", "lint"]);

    children[1]!.exit(0);
    await settle();
    expect(running(children)).toEqual(["lint", "tsc"]);

    children[0]!.exit(0);
    await settle();
    expect(running(children)).toEqual(["lint", "tsc", "test:coverage"]);

    children[2]!.exit(0);
    await expect(result).resolves.toBe(0);
    const text = output.join("");
    expect(text).toContain("── tsc passed");
    expect(text).toContain("lint output");
    expect(text).toMatch(/✓ test:coverage/);
  });

  it("stops after a failing stage and returns the failing exit code", async () => {
    const { children, spawnProcess } = fakeSpawner();
    const output: string[] = [];
    const result = runCheck({
      stages: [["lint", "tsc"], ["test:coverage"]],
      spawnProcess,
      write: (text) => output.push(text),
    });

    children[0]!.exit(0);
    children[1]!.exit(2);

    await expect(result).resolves.toBe(2);
    expect(running(children)).toEqual(["lint", "tsc"]);
    const text = output.join("");
    expect(text).toContain("── tsc failed (exit 2)");
    expect(text).toContain("tsc output");
    expect(text).toMatch(/✗ tsc/);
  });

  it("fails when a script cannot be started", async () => {
    const { children, spawnProcess } = fakeSpawner();
    const output: string[] = [];
    const result = runCheck({
      stages: [["lint"]],
      spawnProcess,
      write: (text) => output.push(text),
    });

    children[0]!.child.emit("error", new Error("spawn npm ENOENT"));
    children[0]!.exit(-2);

    await expect(result).resolves.toBe(1);
    const text = output.join("");
    expect(text).toContain("spawn npm ENOENT");
    expect(text.match(/── lint failed/g)).toHaveLength(1);
  });

  it("forwards an interrupt to every running script and stops", async () => {
    const { children, spawnProcess } = fakeSpawner();
    const listeners = new Map<string, () => void>();
    vi.spyOn(process, "on").mockImplementation(((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return process;
    }) as typeof process.on);
    vi.spyOn(process, "off").mockImplementation((() => process) as typeof process.off);

    const result = runCheck({
      stages: [["lint", "tsc"], ["test:coverage"]],
      spawnProcess,
      write: () => {},
    });

    listeners.get("SIGINT")!();
    expect(children[0]!.child.kill).toHaveBeenCalledWith("SIGINT");
    expect(children[1]!.child.kill).toHaveBeenCalledWith("SIGINT");

    children[0]!.exit(0);
    children[1]!.exit(null, "SIGINT");

    await expect(result).resolves.toBe(130);
    expect(running(children)).toEqual(["lint", "tsc"]);
  });

  it("summarises each script's result and duration", () => {
    expect(
      formatSummary(
        [
          { script: "lint", exitCode: 0, durationMs: 1234 },
          { script: "test:coverage", exitCode: 1, durationMs: 98_760 },
        ],
        100_000
      )
    ).toBe(
      [
        "",
        "check summary",
        "  ✓ lint              1.2s",
        "  ✗ test:coverage    98.8s",
        "  total 100.0s",
        "",
      ].join("\n")
    );
  });
});
