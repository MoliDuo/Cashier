#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@formatjs/icu-messageformat-parser";

/**
 * Message keys are typed (src/i18n/app-config.d.ts), so tsc reports a missing
 * key. What is left here is what types cannot see: ICU syntax, keys rendered
 * as raw strings, and keys that nothing reads any more.
 */

export interface Token {
  type: "identifier" | "number" | "punctuator" | "string" | "regex";
  value: string;
  start: number;
  /** Set on the brackets that stand in for a template substitution's `${` and `}`. */
  template?: boolean;
}

/** A dotted string literal and where it starts in its file. */
export interface DottedLiteral {
  value: string;
  start: number;
}

export interface TranslationUsage {
  staticKeys: string[];
  literals: string[];
  dottedLiterals: DottedLiteral[];
}

/** A file under src, by its repository-relative name. */
export interface SourceFile {
  fileName: string;
  source: string;
}

const CATALOG_FILE = "zh.json";
/**
 * Namespaces read straight from the JSON rather than through a translator, so
 * the scan below cannot see which of their keys are used.
 */
const DIRECTLY_READ_NAMESPACES = ["AuthEmail"];
const FACTORY_NAMES = ["getTranslations", "createTranslator"];
const TRANSLATOR_METHODS = new Set(["raw", "rich", "markup", "has"]);
const DECLARATION_STARTS = ["const", "let", "var", ","];
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
]);
const PUNCTUATOR =
  /=>|\.\.\.|\?\?=|\?\.(?!\d)|[=!]==?|[<>]=|&&=?|\|\|=?|\?\?|\*\*=?|<<=?|>>>?=?|[-+*/%&|^]=|\+\+|--|[{}()[\];,<>+\-*/%&|^!~?:=.@#]/y;
const IDENTIFIER = /[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*/uy;
const NUMBER = /(?:0[xXoObB][\da-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/y;
/** The sticky patterns tried, in order, where no other token starts. */
const WORD_PATTERNS: readonly (readonly [Token["type"], RegExp])[] = [
  ["identifier", IDENTIFIER],
  ["number", NUMBER],
  ["punctuator", PUNCTUATOR],
];

const ESCAPES: Record<string, string> = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  0: "\0",
};

function cook(raw: string): string {
  return raw.replace(
    /\\(?:u\{([\da-fA-F]+)\}|u([\da-fA-F]{4})|x([\da-fA-F]{2})|(\r\n|[\n\r\u2028\u2029])|([\s\S]))/gu,
    (
      _match: string,
      codePoint: string | undefined,
      unicode: string | undefined,
      hex: string | undefined,
      lineBreak: string | undefined,
      // The one group left when none of the others matched.
      other: string
    ) => {
      if (codePoint != null) return String.fromCodePoint(Number.parseInt(codePoint, 16));
      const escaped = unicode ?? hex;
      if (escaped != null) return String.fromCharCode(Number.parseInt(escaped, 16));
      if (lineBreak != null) return "";
      return ESCAPES[other] ?? other;
    }
  );
}

/**
 * Split TypeScript source into tokens without a compiler: identifiers,
 * punctuators, and string literals (plain strings and templates without
 * substitutions, as the compiler would name them). Comments, numbers, regular
 * expressions, and template parts around substitutions are skipped. JSX text
 * is read as code, which only matters if it holds a quote character.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  /** Brace depth inside each open template substitution. */
  const templateDepths: number[] = [];
  let index = 0;

  const previous = () => tokens.at(-1);
  const regexAllowed = () => {
    const token = previous();
    if (token == null) return true;
    if (token.type === "identifier") return REGEX_PRECEDING_KEYWORDS.has(token.value);
    if (token.type === "punctuator") return !/^(?:\)|\]|\}|\+\+|--)$/.test(token.value);
    return false;
  };

  /** Read a template from `start` (just past a backtick or a closing `}`). */
  const readTemplate = (start: number, opensAtBacktick: boolean): number => {
    let cursor = start;
    while (cursor < source.length) {
      const char = source[cursor];
      if (char === "\\") {
        cursor += 2;
      } else if (char === "`") {
        if (opensAtBacktick) {
          tokens.push({
            type: "string",
            value: cook(source.slice(start, cursor)),
            start: start - 1,
          });
        }
        return cursor + 1;
      } else if (char === "$" && source[cursor + 1] === "{") {
        templateDepths.push(0);
        tokens.push({ type: "punctuator", value: "(", start: cursor, template: true });
        return cursor + 2;
      } else {
        cursor++;
      }
    }
    return cursor;
  };

  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (/\s/.test(char)) {
      index++;
    } else if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else if (char === '"' || char === "'") {
      let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== char && source[cursor] !== "\n") {
        cursor += source[cursor] === "\\" ? 2 : 1;
      }
      tokens.push({ type: "string", value: cook(source.slice(index + 1, cursor)), start: index });
      index = cursor + 1;
    } else if (char === "`") {
      index = readTemplate(index + 1, true);
    } else if (char === "}" && templateDepths.at(-1) === 0) {
      templateDepths.pop();
      tokens.push({ type: "punctuator", value: ")", start: index, template: true });
      index = readTemplate(index + 1, false);
    } else if (char === "/" && previous()?.value !== "<" && regexAllowed()) {
      let cursor = index + 1;
      let inClass = false;
      while (cursor < source.length && source[cursor] !== "\n") {
        const current = source[cursor];
        if (current === "\\") cursor++;
        else if (current === "[") inClass = true;
        else if (current === "]") inClass = false;
        else if (current === "/" && !inClass) break;
        cursor++;
      }
      index = cursor + 1;
      IDENTIFIER.lastIndex = index;
      if (IDENTIFIER.exec(source) != null) index = IDENTIFIER.lastIndex;
      tokens.push({ type: "regex", value: "", start: index });
    } else {
      let matched = false;
      for (const [type, pattern] of WORD_PATTERNS) {
        pattern.lastIndex = index;
        const match = pattern.exec(source);
        if (match == null || match[0] === "") continue;
        tokens.push({ type, value: match[0], start: index });
        index = pattern.lastIndex;
        matched = true;
        break;
      }
      if (!matched) index++;
      const last = previous();
      const depth = templateDepths.length - 1;
      if (depth >= 0 && last?.type === "punctuator") {
        if (last.value === "{") templateDepths[depth]!++;
        else if (last.value === "}") templateDepths[depth]!--;
      }
    }
  }
  return tokens;
}

/** A string token that is a whole argument or initializer on its own. */
function standaloneString(tokens: Token[], index: number): string | null {
  const token = tokens[index];
  const after = tokens[index + 1]?.value;
  return token?.type === "string" && (after === "," || after === ")" || after === "}")
    ? token.value
    : null;
}

/** `[imported, local]` pairs of the named bindings of the import at `index`. */
function namedImports(tokens: Token[], index: number): [string, string][] {
  let cursor = index;
  while (cursor < tokens.length && !["{", ";", "from"].includes(tokens[cursor]!.value)) cursor++;
  if (tokens[cursor]?.value !== "{") return [];
  const pairs: [string, string][] = [];
  let element: string[] = [];
  for (cursor++; cursor < tokens.length; cursor++) {
    const value = tokens[cursor]!.value;
    if (value === "," || value === "}") {
      const names = element[0] === "type" && element.length > 1 ? element.slice(1) : element;
      const [imported, , local] = names;
      if (imported != null) pairs.push([imported, local ?? imported]);
      element = [];
      if (value === "}") break;
    } else {
      element.push(value);
    }
  }
  return pairs;
}

/** Where a declarator's initializer starts, past a type annotation on a first declarator. */
function initializerStart(tokens: Token[], index: number): number | null {
  if (tokens[index]?.value === "=") return index + 1;
  if (tokens[index]?.value !== ":" || tokens[index - 2]?.value === ",") return null;
  for (let cursor = index + 1; cursor < tokens.length; cursor++) {
    const value = tokens[cursor]!.value;
    if (value === "=") return cursor + 1;
    if (value === ";" || value === "const" || value === "let") return null;
  }
  return null;
}

/** The namespace a translator factory call binds, or null when it is not static. */
function factoryNamespace(tokens: Token[], openIndex: number): string | null {
  const first = tokens[openIndex + 1];
  if (first?.value === ")") return "";
  const literal = standaloneString(tokens, openIndex + 1);
  if (literal != null) return literal;
  if (first?.value !== "{") return null;
  let depth = 0;
  for (let index = openIndex + 1; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.type === "punctuator" && /^[{[(]$/.test(token.value)) depth++;
    if (token.type === "punctuator" && /^[}\])]$/.test(token.value)) {
      depth--;
      if (depth === 0) break;
    }
    const isKey =
      depth === 1 &&
      token.value === "namespace" &&
      tokens[index + 1]?.value === ":" &&
      /^[{,]$/.test(tokens[index - 1]?.value ?? "");
    if (isKey) {
      return tokens[index + 2]?.type === "string" ? standaloneString(tokens, index + 2) : null;
    }
  }
  return "";
}

/**
 * Translator usage in one source file: the keys read with a static argument,
 * every string literal (a dynamic key is built from one of these), and
 * dotted string literals that are not the namespace of a translator factory.
 */
export function collectTranslationUsage(source: string): TranslationUsage {
  const tokens = tokenize(source);
  const translatorHooks = new Set(["useTranslations"]);
  const translatorFactories = new Set(FACTORY_NAMES);
  const bindings = new Map<string, string>();
  const staticKeys: string[] = [];
  const literals: string[] = [];
  const dottedLiterals: DottedLiteral[] = [];
  /** Callee of each open bracket, or null for a non-call bracket. */
  const openCalls: (string | null)[] = [];

  for (const [index, token] of tokens.entries()) {
    const before = tokens[index - 1];

    if (token.value === "import" && before?.value !== "." && tokens[index + 1]?.value !== "(") {
      for (const [imported, local] of namedImports(tokens, index + 1)) {
        if (imported === "useTranslations" || local === "useTranslations") {
          translatorHooks.add(local);
        }
        if (FACTORY_NAMES.includes(imported) || FACTORY_NAMES.includes(local)) {
          translatorFactories.add(local);
        }
      }
    }

    const initializer =
      token.type === "identifier" && before != null && DECLARATION_STARTS.includes(before.value)
        ? initializerStart(tokens, index + 1)
        : null;
    if (initializer != null) {
      let callee = initializer;
      const awaited = tokens[callee]?.value === "await" || tokens[callee]?.value === "(";
      while (tokens[callee]?.value === "await" || tokens[callee]?.value === "(") callee++;
      const name = tokens[callee]?.value;
      if (name != null && tokens[callee + 1]?.value === "(") {
        if (!awaited && translatorHooks.has(name)) {
          const namespace = standaloneString(tokens, callee + 2);
          if (namespace != null) bindings.set(token.value, namespace);
        } else if (translatorFactories.has(name)) {
          const namespace = factoryNamespace(tokens, callee + 1);
          if (namespace != null) bindings.set(token.value, namespace);
        }
      }
    }

    if (token.type === "identifier" && before?.value !== "." && before?.value !== "?.") {
      const direct = tokens[index + 1]?.value === "(" ? index + 1 : null;
      const method =
        tokens[index + 1]?.value === "." &&
        TRANSLATOR_METHODS.has(tokens[index + 2]?.value ?? "") &&
        tokens[index + 3]?.value === "("
          ? index + 3
          : null;
      const open = direct ?? method;
      const namespace = bindings.get(token.value);
      if (open != null && namespace != null && before?.value !== "function") {
        const key = standaloneString(tokens, open + 1);
        if (key != null) staticKeys.push(namespace === "" ? key : `${namespace}.${key}`);
      }
    }

    if (token.type === "punctuator" && /^[{[(]$/.test(token.value)) {
      const isCall =
        token.value === "(" && !token.template && before?.type === "identifier" ? before : null;
      openCalls.push(isCall?.value ?? null);
    } else if (token.type === "punctuator" && /^[}\])]$/.test(token.value)) {
      openCalls.pop();
    }

    if (token.type === "string") {
      literals.push(token.value);
      const callee = openCalls.at(-1);
      const isFactoryArgument =
        callee != null &&
        /^[(,]$/.test(before?.value ?? "") &&
        standaloneString(tokens, index) != null &&
        (translatorHooks.has(callee) || translatorFactories.has(callee));
      if (!isFactoryArgument && token.value.includes(".")) {
        dottedLiterals.push({ value: token.value, start: token.start });
      }
    }
  }

  return { staticKeys, literals, dottedLiterals };
}

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return [path, ...flattenKeys(nested, path)];
  });
}

function leafKeys(value: unknown, prefix = ""): string[] {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, nested]) =>
      leafKeys(nested, prefix === "" ? key : `${prefix}.${key}`)
    );
  }
  return [prefix];
}

function duplicateTopLevelKeys(content: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const [, key] of content.matchAll(/^ {2}"([^"]+)":/gm)) {
    if (key == null) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort();
}

function icuErrors(value: unknown, location: string): string[] {
  if (typeof value === "string") {
    try {
      parse(value);
      return [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [`${CATALOG_FILE}:${location}: invalid ICU message: ${message}`];
    }
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => icuErrors(item, `${location}[${index}]`));
  }
  if (value != null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) =>
      icuErrors(nested, location === "" ? key : `${location}.${key}`)
    );
  }
  return [];
}

/**
 * Validates the raw catalog JSON against the files under src, returning the
 * validation errors.
 */
export function validateCatalog(catalogContent: string, sources: SourceFile[]): string[] {
  const errors: string[] = [];
  const duplicates = duplicateTopLevelKeys(catalogContent);
  if (duplicates.length > 0) {
    errors.push(`${CATALOG_FILE}: duplicate top-level keys detected: ${duplicates.join(", ")}`);
  }

  let catalog: unknown;
  try {
    catalog = JSON.parse(catalogContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [...errors, `${CATALOG_FILE}: invalid JSON: ${message}`];
  }
  errors.push(...icuErrors(catalog, ""));

  const catalogKeys = new Set(flattenKeys(catalog));
  const staticKeys = new Set<string>();
  const literals = new Set<string>();
  for (const { fileName, source } of sources) {
    const usage = collectTranslationUsage(source);
    for (const key of usage.staticKeys) staticKeys.add(key);
    for (const literal of usage.literals) literals.add(literal);
    for (const { value, start } of usage.dottedLiterals) {
      if (!catalogKeys.has(value)) continue;
      const line = source.slice(0, start).split("\n").length;
      errors.push(`${fileName}:${line}: raw translation key rendered directly: ${value}`);
    }
  }

  /**
   * A message nobody can render is dead weight that survives every feature
   * removal. A key counts as used when a translator reads it (or an object
   * that contains it) statically, or when its last segment appears as a string
   * literal somewhere in src — the conservative reading of a dynamic `t(key)`.
   */
  for (const key of leafKeys(catalog)) {
    if (DIRECTLY_READ_NAMESPACES.some((namespace) => key.startsWith(`${namespace}.`))) continue;
    const segments = key.split(".");
    const readStatically = segments.some((_segment, index) =>
      staticKeys.has(segments.slice(0, index + 1).join("."))
    );
    if (!readStatically && !literals.has(segments.at(-1) ?? "")) {
      errors.push(`${CATALOG_FILE}: unused message key ${key}`);
    }
  }
  return errors;
}

function sourceFilesIn(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(entryPath);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

function main(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sources = sourceFilesIn(path.join(root, "src")).map((file) => ({
    fileName: path.relative(root, file).split(path.sep).join("/"),
    source: fs.readFileSync(file, "utf8"),
  }));
  const errors = validateCatalog(
    fs.readFileSync(path.join(root, "messages", CATALOG_FILE), "utf8"),
    sources
  );
  if (errors.length > 0) {
    console.error("i18n catalog validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Validated ${CATALOG_FILE} successfully.`);
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
