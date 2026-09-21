#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
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

function collectIcuArgumentNames(elements, names = new Set()) {
  for (const element of elements) {
    if (
      [TYPE.argument, TYPE.number, TYPE.date, TYPE.time, TYPE.select, TYPE.plural].includes(
        element.type
      )
    ) {
      names.add(element.value);
    }
    if (element.options != null) {
      for (const option of Object.values(element.options)) {
        collectIcuArgumentNames(option.value, names);
      }
    }
    if (element.children != null) {
      collectIcuArgumentNames(element.children, names);
    }
  }
  return names;
}

function parseIcuMessage(message, location) {
  try {
    const ast = parse(message);
    return collectIcuArgumentNames(ast);
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
  const dynamicUsages = [];

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
          } else {
            dynamicUsages.push({
              fileName: sourceFile.fileName,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              namespace: null,
              kind: "dynamic namespace",
            });
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
        if (key == null) {
          dynamicUsages.push({
            fileName: sourceFile.fileName,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            namespace,
            kind: "dynamic key",
          });
        }
      }
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
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
  return { usages, rawKeyLiterals, dynamicUsages };
}

const VISIBLE_ATTRIBUTE_NAMES = new Set([
  "title",
  "aria-label",
  "aria-description",
  "placeholder",
  "alt",
]);
const VISIBLE_TEXT_ALLOWLIST = new Map([
  ["src/components/LanguageSwitcher.tsx", new Set(["中文", "English"])],
  ["src/components/ui/calculator-input.tsx", new Set(["AC"])],
  ["src/modules/auth/ui/login-page.tsx", new Set(["C", "Cashier"])],
]);

function collectVisibleStringLiterals(sourceFile, relativeFileName) {
  const findings = [];

  function record(node, text) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized === "" || !/\p{L}/u.test(normalized)) return;
    if (VISIBLE_TEXT_ALLOWLIST.get(relativeFileName)?.has(normalized)) return;
    findings.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      text: normalized,
    });
  }

  function collectExpressionStrings(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      record(node, node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      record(node.head, node.head.text);
      for (const span of node.templateSpans) record(span.literal, span.literal.text);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      collectExpressionStrings(node.whenTrue);
      collectExpressionStrings(node.whenFalse);
      return;
    }
    if (ts.isParenthesizedExpression(node)) {
      collectExpressionStrings(node.expression);
    }
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      record(node, node.text);
    } else if (ts.isJsxAttribute(node)) {
      const attributeName = node.name.getText(sourceFile);
      if (VISIBLE_ATTRIBUTE_NAMES.has(attributeName) && node.initializer != null) {
        if (ts.isStringLiteral(node.initializer)) {
          record(node.initializer, node.initializer.text);
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression != null) {
          collectExpressionStrings(node.initializer.expression);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
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
    const { usages, rawKeyLiterals, dynamicUsages } = collectTranslationUsages(sourceFile);
    const relativeFileName = path
      .relative(path.resolve(currentDirPath, ".."), fileName)
      .split(path.sep)
      .join("/");
    const visibleStringLiterals = collectVisibleStringLiterals(sourceFile, relativeFileName);

    for (const usage of usages) {
      const location = `${relativeFileName}:${usage.line}`;
      if (usage.reason != null) {
        errors.push(`${location}: ${usage.reason}`);
        continue;
      }
      if (usage.key == null) {
        // Dynamic keys cannot be expanded safely from syntax alone. Still
        // validate the statically known namespace and report the usage so it
        // is visible in CI output.
        if (usage.namespace !== "" && getMessageValue(catalog, usage.namespace) === undefined) {
          errors.push(`${location}: missing message namespace ${usage.namespace} for dynamic key`);
        }
        continue;
      }
      const fullKey = usage.namespace === "" ? usage.key : `${usage.namespace}.${usage.key}`;
      if (getMessageValue(catalog, fullKey) === undefined) {
        errors.push(`${location}: missing message key ${fullKey}`);
      }
    }

    for (const rawKey of rawKeyLiterals) {
      errors.push(
        `${relativeFileName}:${rawKey.line}: raw translation key rendered directly: ${rawKey.key}`
      );
    }

    for (const dynamicUsage of dynamicUsages) {
      const namespace =
        dynamicUsage.namespace == null || dynamicUsage.namespace === ""
          ? "<root>"
          : dynamicUsage.namespace;
      errors.push(
        `${relativeFileName}:${dynamicUsage.line}: i18n ${dynamicUsage.kind} is not allowed in namespace ${namespace}`
      );
    }

    for (const visibleString of visibleStringLiterals) {
      errors.push(
        `${relativeFileName}:${visibleString.line}: hard-coded visible text: ${JSON.stringify(
          visibleString.text
        )}`
      );
    }
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
