#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const testRoot = path.join(root, "tests");
const sourceExtensions = [".ts", ".tsx", ".mts", ".mjs"];

function collect(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    return statSync(absolute).isDirectory()
      ? collect(absolute)
      : sourceExtensions.includes(path.extname(entry))
        ? [absolute]
        : [];
  });
}

function resolveImport(from, specifier) {
  let candidate;
  if (specifier.startsWith("tests/"))
    candidate = path.join(testRoot, specifier.slice("tests/".length));
  else if (specifier.startsWith(".")) candidate = path.resolve(path.dirname(from), specifier);
  else return null;

  for (const resolved of [
    candidate,
    ...sourceExtensions.map((extension) => candidate + extension),
    ...sourceExtensions.map((extension) => path.join(candidate, `index${extension}`)),
  ]) {
    if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
  }
  return null;
}

function staticImportSpecifiers(source) {
  const specifiers = [];
  const importPattern = /^\s*import\s+(?:(?:type\s+)?[\s\S]*?\s+from\s+)?["']([^"']+)["'];?/gm;
  for (const match of source.matchAll(importPattern)) {
    if (match[1] != null) specifiers.push(match[1]);
  }
  return specifiers;
}

function relativePath(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function isSetupImport(file, specifier) {
  if (specifier === "tests/setup") return true;
  const resolved = resolveImport(file, specifier);
  return resolved != null && relativePath(resolved) === "tests/setup.ts";
}

/**
 * The file that exercises these rules carries a sample of every shape they
 * reject, written out so a reader can see what is being caught. Scanning it
 * would report its own fixtures, so it is named here rather than hidden behind
 * a marker any file could adopt.
 */
const RULE_FIXTURES = "tests/unit/scripts/check-test-architecture.test.ts";

const violations = [];
if (!existsSync(path.join(root, RULE_FIXTURES))) {
  // A rename that leaves the exemption behind would quietly stop exempting
  // anything, and the rules would start reporting the fixtures again.
  violations.push(`${RULE_FIXTURES}: the exempted rule fixtures are missing; update RULE_FIXTURES`);
}
const unitFiles = collect(path.join(testRoot, "unit"));
const integrationFiles = collect(path.join(testRoot, "integration"));

for (const file of unitFiles) {
  if (relativePath(file) === RULE_FIXTURES) continue;
  const source = readFileSync(file, "utf8");
  for (const specifier of staticImportSpecifiers(source)) {
    if (isSetupImport(file, specifier)) {
      violations.push(`${relativePath(file)}: unit tests must not statically import tests/setup`);
    }
    if (specifier === "@/lib/db") {
      violations.push(`${relativePath(file)}: unit tests must not statically import @/lib/db`);
    }
    if (specifier === "pg") {
      violations.push(`${relativePath(file)}: unit tests must not import pg`);
    }
  }
  if (/\bgetTestDb\s*\(/.test(source)) {
    violations.push(`${relativePath(file)}: unit tests must not call getTestDb()`);
  }
}

for (const file of integrationFiles) {
  const source = readFileSync(file, "utf8");
  if (/\b(?:it|test|describe)\s*\.\s*concurrent\b/.test(source)) {
    violations.push(`${relativePath(file)}: integration tests must not use concurrent tests`);
  }
}

/**
 * Rules about what a test is allowed to assert.
 *
 * Each one exists because the suite already paid for it: a snapshot nobody
 * reads before approving, a typography class that fails when a role is retuned
 * and passes when a component stops using the role, and a bare `toThrow()` that
 * was satisfied by an access check firing long before the validation it claimed
 * to cover. They are cheap to keep and expensive to rediscover.
 */

/** Tailwind tokens that describe how text and boxes are drawn, not what they do. */
const PRESENTATION_CLASS =
  /^(?:text-(?:xs|sm|base|lg|xl|[2-9]xl|micro)|font-(?:thin|light|normal|medium|semibold|bold|extrabold)|[pm][xytblre]?-\d|[pm][xytblre]?-\[|gap-\d|leading-|tracking-|rounded(?:-[a-z]+)?(?:-\[)?$|opacity-\d)/;

function assertionArguments(source, matcher) {
  const values = [];
  const pattern = new RegExp(`\\.(?:not\\.)?${matcher}\\(([^;]*?)\\)\\s*;`, "gs");
  for (const match of source.matchAll(pattern)) {
    if (match[1] != null) values.push(match[1]);
  }
  return values;
}

for (const file of [...unitFiles, ...integrationFiles]) {
  const name = relativePath(file);
  if (name === RULE_FIXTURES) continue;
  const source = readFileSync(file, "utf8");

  if (/\.toMatchSnapshot\s*\(|\.toMatchFileSnapshot\s*\(/.test(source)) {
    violations.push(
      `${name}: snapshots record what the code does today rather than what it must do; assert the behaviour instead`
    );
  }

  for (const argument of assertionArguments(source, "toHaveClass")) {
    for (const token of argument.match(/"[^"]+"|'[^']+'/g) ?? []) {
      const className = token.slice(1, -1);
      if (PRESENTATION_CLASS.test(className)) {
        violations.push(
          `${name}: toHaveClass("${className}") pins a size or spacing; assert the shared role or variant (tests/helpers/class-tables) or the behaviour it stands for`
        );
      }
    }
  }

  // `rejects.toThrow()` with nothing in it passes for any rejection, including
  // one from a guard that fired before the code under test was reached.
  if (/\brejects\s*\.\s*toThrow\s*\(\s*\)/.test(source)) {
    violations.push(
      `${name}: rejects.toThrow() accepts any rejection; name the error type, message or code`
    );
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(`Test architecture: ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Test architecture: ${unitFiles.length} unit files and ${integrationFiles.length} integration files comply`
  );
}
