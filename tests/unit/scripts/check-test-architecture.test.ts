import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const checkerScript = path.join(process.cwd(), "scripts/check-test-architecture.mjs");
const tempRoots: string[] = [];

function makeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "test-arch-check-"));
  tempRoots.push(root);
  // The checker insists its exempted fixture file exists, so that a rename
  // cannot leave the exemption pointing at nothing. Every fixture root carries
  // an empty one, which is also what proves the exemption is by path and not
  // by content: the offending samples below sit elsewhere and are still caught.
  const withExemption = {
    "tests/unit/scripts/check-test-architecture.test.ts": "",
    ...files,
  };
  for (const [relative, content] of Object.entries(withExemption)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

function runChecker(root: string): { status: number; output: string } {
  try {
    return {
      status: 0,
      output: execFileSync(process.execPath, [checkerScript], { cwd: root, encoding: "utf8" }),
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("check-test-architecture", () => {
  it("passes a suite that keeps the database out of unit tests and names its rejections", () => {
    const result = runChecker(
      makeFixture({
        "tests/unit/money.test.ts": `
          import { expect, it } from "vitest";
          it("rounds half up", async () => {
            await expect(save()).rejects.toThrow(ValidationError);
            expect(round("1.235", 2)).toBe("1.24");
          });
        `,
        "tests/integration/ledger.test.ts": `
          import { getTestDb } from "tests/setup";
          it("writes", () => expect(getTestDb()).toBeDefined());
        `,
      })
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain("2 unit files and 1 integration files comply");
  });

  /**
   * Each rule is checked against the shape it was written for and against a
   * near miss it must leave alone, so a rule that has stopped matching anything
   * cannot pass as a rule that finds nothing to complain about.
   */
  const CASES: Array<[rule: string, offending: string, expected: string, allowed: string]> = [
    [
      "snapshots",
      `it("renders", () => expect(view).toMatchSnapshot());`,
      "snapshots record what the code does today",
      `it("renders", () => expect(view).toMatchObject({ title: "Lunch" }));`,
    ],
    [
      "a pinned text size",
      `it("titles", () => expect(heading).toHaveClass("text-sm", "font-medium"));`,
      'toHaveClass("text-sm") pins a size or spacing',
      `it("titles", () => expect(heading).toHaveClass("sr-only", "text-muted-foreground"));`,
    ],
    [
      "a pinned magic inset",
      `it("insets", () => expect(band).toHaveClass("px-[13px]"));`,
      'toHaveClass("px-[13px]") pins a size or spacing',
      `it("insets", () => expect(band).toHaveClass("truncate"));`,
    ],
    [
      "an unnamed rejection",
      `it("refuses", async () => { await expect(act()).rejects.toThrow(); });`,
      "rejects.toThrow() accepts any rejection",
      `it("refuses", async () => { await expect(act()).rejects.toThrow(NotFoundError); });`,
    ],
  ];

  for (const [rule, offending, expected, allowed] of CASES) {
    it(`rejects ${rule} and accepts what it must not catch`, () => {
      const bad = runChecker(makeFixture({ "tests/unit/sample.test.ts": offending }));
      expect(bad.status).toBe(1);
      expect(bad.output).toContain(expected);

      const good = runChecker(makeFixture({ "tests/unit/sample.test.ts": allowed }));
      expect({ rule, status: good.status, output: good.output.trim() }).toEqual({
        rule,
        status: 0,
        output: expect.stringContaining("comply"),
      });
    });
  }

  it("still keeps the database out of unit tests", () => {
    const result = runChecker(
      makeFixture({
        "tests/unit/leaky.test.ts": `
          import { db } from "@/lib/db";
          it("reads", () => expect(getTestDb()).toBeDefined());
        `,
      })
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain("unit tests must not statically import @/lib/db");
    expect(result.output).toContain("unit tests must not call getTestDb()");
  });
});
