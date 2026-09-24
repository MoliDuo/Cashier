#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@formatjs/icu-messageformat-parser";
import ts from "typescript";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const CATALOG_FILE = "zh.json";
const catalogPath = path.resolve(currentDirPath, "..", "messages", CATALOG_FILE);

function getDuplicateTopLevelKeys(content) {
  const matches = content.matchAll(/^ {2}"([^"]+)":/gm);
  const seen = new Set();
  const duplicates = new Set();

  for (const match of matches) {
    const key = match[1];
    if (seen.has(key)) {
      duplicates.add(key);
      continue;
    }
    seen.add(key);
  }

  return [...duplicates].sort();
}

function flattenKeys(value, prefix = "") {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const nextPrefix = prefix === "" ? key : `${prefix}.${key}`;
    return [nextPrefix, ...flattenKeys(nestedValue, nextPrefix)];
  });
}

function parseIcuMessage(message, location) {
  try {
    parse(message);
  } catch (error) {
    errors.push(
      `${location}: invalid ICU message: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * There is one catalog, so nothing can disagree with anything: the only shape
 * question left is whether each message is valid ICU. `parseIcuMessage`
 * records its own errors.
 */
function checkIcuMessages(value, location) {
  if (typeof value === "string") {
    parseIcuMessage(value, `${CATALOG_FILE}:${location}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkIcuMessages(item, `${location}[${index}]`));
    return;
  }
  if (value != null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      checkIcuMessages(nested, location === "" ? key : `${location}.${key}`);
    }
  }
}

const errors = [];
const rawContent = fs.readFileSync(catalogPath, "utf8");
const duplicateTopLevelKeys = getDuplicateTopLevelKeys(rawContent);

if (duplicateTopLevelKeys.length > 0) {
  errors.push(
    `${CATALOG_FILE}: duplicate top-level keys detected: ${duplicateTopLevelKeys.join(", ")}`
  );
}

let catalog = null;
try {
  catalog = JSON.parse(rawContent);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  errors.push(`${CATALOG_FILE}: invalid JSON: ${message}`);
}

const referenceKeys = new Set();
/** Every string literal in src: a dynamic key is built from one of these. */
const sourceLiterals = new Set();
const staticKeys = new Set();
/**
 * Namespaces read straight from the JSON rather than through a translator, so
 * the scan below cannot see which of their keys are used.
 */
const DIRECTLY_READ_NAMESPACES = ["AuthEmail"];

if (catalog != null) {
  for (const key of flattenKeys(catalog)) referenceKeys.add(key);
  checkIcuMessages(catalog, "");
}

function sourceFilesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(entryPath);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

function literalText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function getMessageValue(catalog, key) {
  return key.split(".").reduce((value, segment) => {
    if (value == null || typeof value !== "object" || !(segment in value)) return undefined;
    return value[segment];
  }, catalog);
}

function collectTranslationUsages(sourceFile) {
  const useTranslationNames = new Set(["useTranslations"]);
  const translationFactoryNames = new Set(["getTranslations", "createTranslator"]);
  const bindings = new Map();
  const usages = [];
  const rawKeyLiterals = [];

  function unwrapExpression(node) {
    let current = node;
    while (
      current != null &&
      (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current))
    ) {
      current = current.expression;
    }
    return current;
  }

  function getFactoryCall(node) {
    const expression = unwrapExpression(node);
    return ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      translationFactoryNames.has(expression.expression.text)
      ? expression
      : null;
  }

  function getFactoryNamespace(call) {
    const firstArgument = call.arguments[0];
    if (firstArgument == null) return "";
    const literalNamespace = literalText(firstArgument);
    if (literalNamespace != null) return literalNamespace;
    if (ts.isObjectLiteralExpression(firstArgument)) {
      const namespaceProperty = firstArgument.properties.find((property) => {
        if (!ts.isPropertyAssignment(property)) return false;
        return (
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
          property.name.text === "namespace"
        );
      });
      if (namespaceProperty != null && ts.isPropertyAssignment(namespaceProperty)) {
        return literalText(namespaceProperty.initializer);
      }
      return "";
    }
    return null;
  }

  function isTranslationFactoryArgument(node) {
    const parent = node.parent;
    return (
      ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      translationFactoryNames.has(parent.expression.text)
    );
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings != null) {
      const namedBindings = node.importClause.namedBindings;
      if (ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          if (
            element.propertyName?.text === "useTranslations" ||
            element.name.text === "useTranslations"
          ) {
            useTranslationNames.add(element.name.text);
          }
          if (
            element.propertyName?.text === "getTranslations" ||
            element.name.text === "getTranslations" ||
            element.propertyName?.text === "createTranslator" ||
            element.name.text === "createTranslator"
          ) {
            translationFactoryNames.add(element.name.text);
          }
        }
      }
    }

    if (ts.isVariableDeclaration(node)) {
      const initializer = node.initializer;
      if (ts.isIdentifier(node.name) && initializer != null) {
        const directTranslationCall =
          ts.isCallExpression(initializer) &&
          ts.isIdentifier(initializer.expression) &&
          useTranslationNames.has(initializer.expression.text)
            ? initializer
            : null;
        const factoryCall = getFactoryCall(initializer);
        if (directTranslationCall != null) {
          const namespace = literalText(directTranslationCall.arguments[0]);
          if (namespace != null) bindings.set(node.name.text, namespace);
        } else if (factoryCall != null) {
          const namespace = getFactoryNamespace(factoryCall);
          if (namespace != null) {
            bindings.set(node.name.text, namespace);
          }
        }
      }
    }

    if (ts.isCallExpression(node)) {
      let bindingName = null;
      let method = "translate";
      if (ts.isIdentifier(node.expression)) {
        bindingName = node.expression.text;
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression)
      ) {
        bindingName = node.expression.expression.text;
        method = node.expression.name.text;
      }

      const namespace = bindingName == null ? undefined : bindings.get(bindingName);
      if (namespace != null && ["translate", "raw", "rich", "markup", "has"].includes(method)) {
        const key = literalText(node.arguments[0]);
        usages.push({
          fileName: sourceFile.fileName,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          namespace,
          key,
          reason: null,
        });
      }
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      sourceLiterals.add(node.text);
      const parent = node.parent;
      const isUseTranslationsArgument =
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        useTranslationNames.has(parent.expression.text);
      if (
        !isUseTranslationsArgument &&
        !isTranslationFactoryArgument(node) &&
        referenceKeys.has(node.text) &&
        node.text.includes(".")
      ) {
        rawKeyLiterals.push({
          fileName: sourceFile.fileName,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          key: node.text,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { usages, rawKeyLiterals };
}

if (catalog != null) {
  const sourceRoot = path.resolve(currentDirPath, "..", "src");

  for (const fileName of sourceFilesIn(sourceRoot)) {
    const source = fs.readFileSync(fileName, "utf8");
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const { usages, rawKeyLiterals } = collectTranslationUsages(sourceFile);
    const relativeFileName = path
      .relative(path.resolve(currentDirPath, ".."), fileName)
      .split(path.sep)
      .join("/");

    for (const usage of usages) {
      const location = `${relativeFileName}:${usage.line}`;
      if (usage.reason != null) {
        errors.push(`${location}: ${usage.reason}`);
        continue;
      }
      if (usage.key == null) {
        // Dynamic keys cannot be expanded safely from syntax alone. Still
        // validate the statically known namespace where it is known.
        if (usage.namespace !== "" && getMessageValue(catalog, usage.namespace) === undefined) {
          errors.push(`${location}: missing message namespace ${usage.namespace} for dynamic key`);
        }
        continue;
      }
      const fullKey = usage.namespace === "" ? usage.key : `${usage.namespace}.${usage.key}`;
      staticKeys.add(fullKey);
      if (getMessageValue(catalog, fullKey) === undefined) {
        errors.push(`${location}: missing message key ${fullKey}`);
      }
    }

    for (const rawKey of rawKeyLiterals) {
      errors.push(
        `${relativeFileName}:${rawKey.line}: raw translation key rendered directly: ${rawKey.key}`
      );
    }
  }
}

function leafKeys(value, prefix = "") {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, nested]) =>
      leafKeys(nested, prefix === "" ? key : `${prefix}.${key}`)
    );
  }
  return [prefix];
}

/**
 * A message nobody can render is dead weight that survives every feature
 * removal. A key counts as used when a translator reads it (or an object that
 * contains it) statically, or when its last segment appears as a string literal
 * somewhere in src — the conservative reading of a dynamic `t(key)`.
 */
if (catalog != null) {
  const unused = leafKeys(catalog).filter((key) => {
    if (DIRECTLY_READ_NAMESPACES.some((namespace) => key.startsWith(`${namespace}.`))) {
      return false;
    }
    const segments = key.split(".");
    for (let length = segments.length; length > 0; length--) {
      if (staticKeys.has(segments.slice(0, length).join("."))) return false;
    }
    return !sourceLiterals.has(segments[segments.length - 1]);
  });
  for (const key of unused) {
    errors.push(`${CATALOG_FILE}: unused message key ${key}`);
  }
}

if (errors.length > 0) {
  console.error("i18n catalog validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Validated ${CATALOG_FILE} successfully.`);
