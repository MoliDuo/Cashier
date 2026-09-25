/**
 * Pure boundary rules for the Cashier source tree.
 *
 * Every rule receives the file's relative path and full source and returns
 * human-readable violations. Rules intentionally inspect static imports,
 * re-exports, and dynamic `import()` specifiers so there is no easy bypass.
 */

import { collectImportSpecifiers, normalizeImportSpecifier } from "./architecture-imports.mjs";
import ts from "typescript";

/**
 * Whether the source starts with a `"use client"` directive after any leading
 * comments and whitespace in the module prologue.
 */
function hasClientDirective(source) {
  let rest = source;
  for (;;) {
    rest = rest.trimStart();
    if (rest.startsWith("//")) {
      const newline = rest.indexOf("\n");
      if (newline === -1) return false;
      rest = rest.slice(newline + 1);
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end === -1) return false;
      rest = rest.slice(end + 2);
      continue;
    }
    break;
  }
  return /^(?:"use client"|'use client');?/.test(rest);
}

const persistencePattern = /^@\/persistence(?:\/|$)/;
const libDbPattern = /^@\/lib\/db(?:\/|$)/;
const s3Pattern = /^@\/lib\/storage\/s3(?:\/|$)/;
const openaiClientPattern = /^@\/lib\/ai\/openai-client(?:\/|$)/;
const serverPattern = /^@\/server(?:\/|$)/;
const moduleServerPattern = /^@\/modules\/[^/]+\/server(?:\/|$)/;
const moduleUiPattern = /^@\/modules\/[^/]+\/(?:ui|hooks)(?:\/|$)/;
const providerSdkPattern = /^(?:pg|openai|resend)$|^drizzle-orm(?:\/|$)|^@aws-sdk\//;
const frameworkPattern = /^(?:next(?:\/|$)|next-auth(?:\/|$)|@auth(?:\/|$))|^server-only$/;
const moduleServerActionsPattern = /^@\/modules\/[^/]+\/server-actions(?:\/|$)/;
const moduleActionsBarrelPattern = /^@\/modules\/[^/]+\/actions$/;
const relativeModuleActionsBarrelPattern = /^(?:\.\/|(?:\.\.\/)+)actions$/;
const appPattern = /^@\/app(?:\/|$)/;
const anyModulePattern = /^@\/modules(?:\/|$)/;
const workspaceModulePattern = /^@\/modules\/workspace(?:\/|$)/;
const registeredSourceDocumentWriters = new Set([
  "src/modules/source-document/server/delete.ts",
  "src/modules/source-document/server/updates.ts",
  "src/modules/source-document/server/split.ts",
  "src/modules/source-document/server/cancel-processing.ts",
  "src/modules/source-document/server/date-organization.ts",
  "src/modules/source-document/server/projections/manual-entries.ts",
  "src/modules/source-document/server/projections/writes.ts",
  "src/modules/source-document/server/revisions.ts",
]);
const forbiddenLogIdentifierProperties = [
  "userId",
  "ledgerId",
  "documentId",
  "sourceDocumentId",
  "revisionId",
  "fileId",
  "storedFileId",
];

function parseSourceFile(relativePath, source) {
  const scriptKind = relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, scriptKind);
}

function importedLogIdentifierNames(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@/lib/security/log-identifier"
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === "logIdentifier") {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function isDirectLogIdentifierCall(expression, logIdentifierNames) {
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    logIdentifierNames.has(expression.expression.text)
  );
}

function collectRawLogIdentifierProperties(sourceFile) {
  const properties = new Set();
  const forbidden = new Set(forbiddenLogIdentifierProperties);
  const logIdentifierNames = importedLogIdentifierNames(sourceFile);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const owner = node.expression.expression.text;
      const method = node.expression.name.text;
      const isLoggerCall =
        owner === "logger" && ["debug", "info", "warn", "error", "fatal"].includes(method);
      const isConsoleCall =
        owner === "console" && ["debug", "info", "warn", "error"].includes(method);
      if (isLoggerCall || isConsoleCall) {
        for (const argument of node.arguments) {
          if (!ts.isObjectLiteralExpression(argument)) continue;
          for (const member of argument.properties) {
            if (ts.isShorthandPropertyAssignment(member) && forbidden.has(member.name.text)) {
              properties.add(member.name.text);
              continue;
            }
            if (!ts.isPropertyAssignment(member)) continue;
            const property = propertyNameText(member.name);
            if (
              property != null &&
              forbidden.has(property) &&
              !isDirectLogIdentifierCall(member.initializer, logIdentifierNames)
            ) {
              properties.add(property);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...properties];
}

const arbitraryTextSizePattern = /(?<![\w-])text-\[\d+(?:\.\d+)?(?:px|rem|em)\]/;
// `text-muted` and `text-muted-foreground` resolve to the same colour token.
const duplicateMutedTokenPattern = /(?<![\w-])text-muted(?![-\w])/;

/**
 * Typography lives in class strings, which are ordinary literals — reading
 * literals instead of the raw source keeps the rules out of comments.
 */
function collectStringLiteralValues(sourceFile) {
  const values = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      values.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      values.push(node.head.text);
      for (const span of node.templateSpans) values.push(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

function collectTypographyViolations(sourceFile) {
  const violations = [];
  const literals = collectStringLiteralValues(sourceFile);
  const arbitrarySize = literals
    .map((value) => arbitraryTextSizePattern.exec(value)?.[0])
    .find((match) => match != null);
  if (arbitrarySize != null) {
    violations.push(
      `text sizes must come from the frozen scale in globals.css, not ${arbitrarySize}`
    );
  }
  if (literals.some((value) => duplicateMutedTokenPattern.test(value))) {
    violations.push("use text-muted-foreground rather than the duplicate text-muted token");
  }
  return violations;
}

function hasSourceDocumentWrite(sourceFile) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["insert", "update", "delete"].includes(node.expression.name.text) &&
      node.arguments.some(
        (argument) => ts.isIdentifier(argument) && argument.text === "sourceDocuments"
      )
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Return boundary violations for one source file.
 *
 * @param {string} relativePath - path relative to the repository root, e.g. src/lib/x.ts
 * @param {string} source - full file contents
 * @returns {string[]}
 */
export function findBoundaryViolations(relativePath, source) {
  const violations = [];
  const sourceFile = parseSourceFile(relativePath, source);
  const rawSpecifiers = collectImportSpecifiers(source, relativePath);
  const specifiers = rawSpecifiers.map((specifier) =>
    normalizeImportSpecifier(relativePath, specifier)
  );
  const moduleMatch = /^src\/modules\/([^/]+)\//.exec(relativePath);
  const isModule = moduleMatch != null;
  const isWorkspaceModule = moduleMatch?.[1] === "workspace";
  const isDomain = /^src\/modules\/[^/]+\/domain\//.test(relativePath);
  const isServerAction = /^src\/modules\/[^/]+\/server-actions\//.test(relativePath);
  const isServerFlow = /^src\/server\//.test(relativePath);
  const isLib = /^src\/lib\//.test(relativePath);
  const isProviders = /^src\/components\/providers\//.test(relativePath);
  const isPersistence = /^src\/persistence\//.test(relativePath);
  const isApiRoute = /^src\/app\/api\//.test(relativePath);
  const isClientComponent = hasClientDirective(source);

  for (const property of collectRawLogIdentifierProperties(sourceFile)) {
    violations.push(
      `${relativePath}: logger/console must use logIdentifier or omit identifier property ${property}`
    );
  }

  for (const violation of collectTypographyViolations(sourceFile)) {
    violations.push(`${relativePath}: ${violation}`);
  }

  if (
    hasSourceDocumentWrite(sourceFile) &&
    !registeredSourceDocumentWriters.has(relativePath) &&
    !relativePath.startsWith("src/persistence/postgres-migrations/")
  ) {
    violations.push(
      `${relativePath}: sourceDocuments writes must live in a registered source-document writer`
    );
  }
  if (registeredSourceDocumentWriters.has(relativePath) && !hasSourceDocumentWrite(sourceFile)) {
    violations.push(
      `${relativePath}: no longer writes sourceDocuments; remove it from registeredSourceDocumentWriters`
    );
  }

  for (const [index, specifier] of specifiers.entries()) {
    const rawSpecifier = rawSpecifiers[index];
    const isDataAccess =
      libDbPattern.test(specifier) ||
      persistencePattern.test(specifier) ||
      providerSdkPattern.test(specifier);
    if (isModule && appPattern.test(specifier)) {
      violations.push(`${relativePath}: modules must not import app entrypoints`);
    }
    if (
      isLib &&
      (anyModulePattern.test(specifier) ||
        appPattern.test(specifier) ||
        serverPattern.test(specifier))
    ) {
      violations.push(`${relativePath}: src/lib must not import modules, app, or src/server`);
    }
    if (isPersistence && (anyModulePattern.test(specifier) || serverPattern.test(specifier))) {
      violations.push(`${relativePath}: persistence must not import modules or src/server`);
    }
    if (isModule && !isWorkspaceModule && workspaceModulePattern.test(specifier)) {
      violations.push(`${relativePath}: domain modules must not depend on workspace orchestration`);
    }
    if (
      isDomain &&
      (isDataAccess ||
        frameworkPattern.test(specifier) ||
        serverPattern.test(specifier) ||
        moduleServerPattern.test(specifier))
    ) {
      violations.push(
        `${relativePath}: domain code must stay pure (no database, providers, frameworks, or server code)`
      );
    }
    if (
      isServerFlow &&
      (appPattern.test(specifier) ||
        moduleServerActionsPattern.test(specifier) ||
        moduleUiPattern.test(specifier))
    ) {
      violations.push(
        `${relativePath}: src/server must not import app entrypoints, server actions, or UI`
      );
    }
    if (
      (isServerAction || isApiRoute) &&
      (isDataAccess ||
        s3Pattern.test(specifier) ||
        openaiClientPattern.test(specifier) ||
        /^(?:ai|openai|resend)$/.test(specifier) ||
        /^@(?:ai-sdk|aws-sdk|google|anthropic-ai)\//.test(specifier))
    ) {
      violations.push(
        `${relativePath}: server actions and api routes must call server functions, not the database or providers`
      );
    }
    if (isProviders && moduleUiPattern.test(specifier)) {
      violations.push(`${relativePath}: src/components/providers must not import module UI`);
    }
    if (
      isClientComponent &&
      (libDbPattern.test(specifier) ||
        persistencePattern.test(specifier) ||
        serverPattern.test(specifier) ||
        moduleServerPattern.test(specifier) ||
        s3Pattern.test(specifier) ||
        openaiClientPattern.test(specifier))
    ) {
      violations.push(`${relativePath}: client components must not import server-only code`);
    }
    if (
      isClientComponent &&
      (moduleActionsBarrelPattern.test(specifier) ||
        (rawSpecifier != null && relativeModuleActionsBarrelPattern.test(rawSpecifier)))
    ) {
      violations.push(
        `${relativePath}: client components must import concrete server actions, not module actions barrels`
      );
    }
    if (
      isApiRoute &&
      (moduleServerActionsPattern.test(specifier) || moduleActionsBarrelPattern.test(specifier))
    ) {
      violations.push(
        `${relativePath}: api routes must not import module server actions or actions barrels`
      );
    }
  }

  return violations;
}
