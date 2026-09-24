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

const serverCompositionRootPattern = /^@\/application\/server-composition-root(?:\/|$)/;
const persistencePattern = /^@\/persistence(?:\/|$)/;
const libDbPattern = /^@\/lib\/db(?:\/|$)/;
const applicationAdaptersPattern = /^@\/application\/adapters(?:\/|$)/;
const s3Pattern = /^@\/lib\/storage\/s3(?:\/|$)/;
const openaiClientPattern = /^@\/lib\/ai\/openai-client(?:\/|$)/;
const moduleUiPattern = /^@\/modules\/[^/]+\/ui(?:\/|$)/;
const providerSdkPattern = /^(?:pg|openai|resend)$|^drizzle-orm(?:\/|$)|^@aws-sdk\//;
const transportFrameworkPattern = /^(?:next(?:\/|$)|next-auth(?:\/|$)|@auth(?:\/|$))/;
const moduleServerActionsPattern = /^@\/modules\/[^/]+\/server-actions(?:\/|$)/;
const moduleActionsBarrelPattern = /^@\/modules\/[^/]+\/actions$/;
const relativeModuleActionsBarrelPattern = /^(?:\.\/|(?:\.\.\/)+)actions$/;
const appPattern = /^@\/app(?:\/|$)/;
const anyModulePattern = /^@\/modules(?:\/|$)/;
const workspaceModulePattern = /^@\/modules\/workspace(?:\/|$)/;
const registeredSourceDocumentWriters = new Set([
  "src/application/adapters/postgres/source-document-delete.ts",
  "src/application/adapters/postgres/source-document-updates.ts",
  "src/application/adapters/postgres/source-document-splits.ts",
  "src/application/adapters/postgres/revisions.ts",
  "src/application/adapters/postgres/submissions.ts",
  "src/application/adapters/postgres/ledger-projections/cancel-source-document-processing.ts",
  "src/application/adapters/postgres/ledger-projections/manual-entries.ts",
  "src/application/adapters/postgres/ledger-projections/adapter.ts",
  "src/application/adapters/postgres/source-document-aggregate/recalculate-current-entries.ts",
  "src/application/adapters/postgres/source-document-date-organization.ts",
  "src/application/adapters/postgres/source-document-aggregate/category-assignments.ts",
]);
const forbiddenLogIdentifierProperties = [
  "userId",
  "ledgerId",
  "documentId",
  "sourceDocumentId",
  "matchedSourceDocumentId",
  "revisionId",
  "fileId",
  "storedFileId",
  "intentId",
  "processingIntentId",
  "uploadSessionId",
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
  const isModuleApplication = /^src\/modules\/[^/]+\/application\//.test(relativePath);
  const moduleMatch = /^src\/modules\/([^/]+)\//.exec(relativePath);
  const isModule = moduleMatch != null;
  const isWorkspaceModule = moduleMatch?.[1] === "workspace";
  const isAuthInternal = /^src\/modules\/auth\/(services|repositories)\//.test(relativePath);
  const isServerAction = /^src\/modules\/[^/]+\/server-actions\//.test(relativePath);
  const isLib = /^src\/lib\//.test(relativePath);
  const isProviders = /^src\/components\/providers\//.test(relativePath);
  const isContracts = /^src\/application\/contracts\//.test(relativePath);
  const isPersistence = /^src\/persistence\//.test(relativePath);
  const isApiRoute = /^src\/app\/api\//.test(relativePath);
  const isInProcessAdapter = /^src\/application\/adapters\/in-process\//.test(relativePath);
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
      `${relativePath}: sourceDocuments writes must use the registered aggregate gateway`
    );
  }

  for (const [index, specifier] of specifiers.entries()) {
    const rawSpecifier = rawSpecifiers[index];
    if (isModule && appPattern.test(specifier)) {
      violations.push(`${relativePath}: modules must not import app entrypoints`);
    }
    if (
      isLib &&
      (anyModulePattern.test(specifier) ||
        appPattern.test(specifier) ||
        applicationAdaptersPattern.test(specifier))
    ) {
      violations.push(
        `${relativePath}: src/lib must not import modules, app, or application adapters`
      );
    }
    if (isPersistence && anyModulePattern.test(specifier)) {
      violations.push(`${relativePath}: persistence must not import domain modules`);
    }
    if (isModule && !isWorkspaceModule && workspaceModulePattern.test(specifier)) {
      violations.push(`${relativePath}: domain modules must not depend on workspace orchestration`);
    }
    if (isModuleApplication && transportFrameworkPattern.test(specifier)) {
      violations.push(`${relativePath}: application code must not import transport frameworks`);
    }
    if ((isModuleApplication || isAuthInternal) && serverCompositionRootPattern.test(specifier)) {
      violations.push(`${relativePath}: application code must receive ports explicitly`);
    }
    if (
      (isModuleApplication || isAuthInternal) &&
      (persistencePattern.test(specifier) ||
        libDbPattern.test(specifier) ||
        applicationAdaptersPattern.test(specifier))
    ) {
      violations.push(`${relativePath}: application code must not import infrastructure adapters`);
    }
    if (
      isServerAction &&
      (specifier === "drizzle-orm" ||
        libDbPattern.test(specifier) ||
        persistencePattern.test(specifier) ||
        applicationAdaptersPattern.test(specifier) ||
        /^(?:ai|openai|resend)$/.test(specifier) ||
        /^@(?:ai-sdk|aws-sdk|google|anthropic-ai)\//.test(specifier))
    ) {
      violations.push(`${relativePath}: server actions must call application ports/use cases`);
    }
    if (isLib && serverCompositionRootPattern.test(specifier)) {
      violations.push(`${relativePath}: src/lib must not import the server composition root`);
    }
    if (isProviders && moduleUiPattern.test(specifier)) {
      violations.push(`${relativePath}: src/components/providers must not import module UI`);
    }
    if (
      isContracts &&
      (persistencePattern.test(specifier) ||
        libDbPattern.test(specifier) ||
        applicationAdaptersPattern.test(specifier) ||
        providerSdkPattern.test(specifier))
    ) {
      violations.push(
        `${relativePath}: application contracts must not import persistence, database, provider SDKs, or application adapters`
      );
    }
    const isInProcessInternalImport = specifier.startsWith("@/application/adapters/in-process/");
    if (
      isInProcessAdapter &&
      (persistencePattern.test(specifier) ||
        libDbPattern.test(specifier) ||
        (applicationAdaptersPattern.test(specifier) && !isInProcessInternalImport))
    ) {
      violations.push(
        `${relativePath}: in-process adapters must receive persistence and concrete adapters explicitly`
      );
    }
    if (
      isClientComponent &&
      (libDbPattern.test(specifier) ||
        persistencePattern.test(specifier) ||
        serverCompositionRootPattern.test(specifier) ||
        s3Pattern.test(specifier) ||
        openaiClientPattern.test(specifier))
    ) {
      violations.push(
        `${relativePath}: client components must not import server-only infrastructure`
      );
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
      (applicationAdaptersPattern.test(specifier) ||
        persistencePattern.test(specifier) ||
        libDbPattern.test(specifier))
    ) {
      violations.push(`${relativePath}: api routes must not import infrastructure adapters or db`);
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
