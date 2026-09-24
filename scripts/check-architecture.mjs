#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { findBoundaryViolations } from "./architecture-rules.mjs";
import { collectImportSpecifiers } from "./architecture-imports.mjs";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const extensions = [".ts", ".tsx", ".mts", ".mjs"];

function collect(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    return statSync(absolute).isDirectory()
      ? collect(absolute)
      : extensions.includes(path.extname(entry))
        ? [absolute]
        : [];
  });
}

function resolveImport(from, specifier) {
  let candidate;
  if (specifier.startsWith("@/")) candidate = path.join(sourceRoot, specifier.slice(2));
  else if (specifier.startsWith(".")) candidate = path.resolve(path.dirname(from), specifier);
  else return null;

  for (const resolved of [
    candidate,
    ...extensions.map((extension) => candidate + extension),
    ...extensions.map((extension) => path.join(candidate, `index${extension}`)),
  ]) {
    if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
  }
  return null;
}

const files = collect(sourceRoot);
const graph = new Map(files.map((file) => [file, []]));
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const specifier of collectImportSpecifiers(source, file)) {
    const target = resolveImport(file, specifier);
    if (target != null) graph.get(file).push(target);
  }
}

const visiting = new Set();
const visited = new Set();
const stack = [];
const cycles = [];
const violations = [];

function visit(file) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    cycles.push([...stack.slice(start), file]);
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of files) visit(file);

for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const source = readFileSync(file, "utf8");
  violations.push(...findBoundaryViolations(relative, source));
}

if (cycles.length > 0 || violations.length > 0) {
  for (const cycle of cycles) {
    console.error(
      `Architecture cycle: ${cycle.map((file) => path.relative(root, file)).join(" -> ")}`
    );
  }
  for (const violation of violations) console.error(`Architecture boundary: ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Architecture graph: ${files.length} source files, zero cycles and zero boundary violations`
  );
}
