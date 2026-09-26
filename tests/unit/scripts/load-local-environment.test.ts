import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocalEnvironment } from "../../../scripts/load-local-environment";

const { files } = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("node:fs", () => ({
  existsSync: (file: string) => files.has(file),
  readFileSync: (file: string) => files.get(file),
}));

beforeEach(() => files.clear());

describe("local environment loading", () => {
  it("preserves process > local > base precedence including empty values", () => {
    files.set("/fixture/.env.local", "A=local\nB=local\nEMPTY=\n");
    files.set("/fixture/.env", "A=base\nB=base\nC=base\nEMPTY=base\n");
    const env: Record<string, string | undefined> = { A: "process" };
    loadLocalEnvironment("/fixture", env);
    expect(env).toEqual({ A: "process", B: "local", C: "base", EMPTY: "" });
  });

  it("parses comments, quotes and multiline values", () => {
    files.set(
      "/fixture/.env",
      'A=value # comment\nB="quoted # literal"\nC=\'single value\'\nD="line1\nline2"\n'
    );
    const env = {};
    loadLocalEnvironment("/fixture", env);
    expect(env).toEqual({
      A: "value",
      B: "quoted # literal",
      C: "single value",
      D: "line1\nline2",
    });
  });

  it("allows absent files", () => {
    const env = { A: "existing" };
    loadLocalEnvironment("/fixture", env);
    expect(env).toEqual({ A: "existing" });
  });
});
