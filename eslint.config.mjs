import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Every file allowed to insert, update or delete `sourceDocuments` rows. */
export const registeredSourceDocumentWriters = [
  "src/modules/source-document/server/delete.ts",
  "src/modules/source-document/server/updates.ts",
  "src/modules/source-document/server/split.ts",
  "src/modules/source-document/server/cancel-processing.ts",
  "src/modules/source-document/server/date-organization.ts",
  "src/modules/source-document/server/projections/manual-entries.ts",
  "src/modules/source-document/server/projections/writes.ts",
  "src/modules/source-document/server/revisions.ts",
];

const identifierKey =
  "/^(?:userId|ledgerId|documentId|sourceDocumentId|revisionId|fileId|storedFileId)$/";
const logCall =
  "CallExpression[callee.type='MemberExpression'][callee.computed=false]:matches(" +
  "[callee.object.name='logger'][callee.property.name=/^(?:debug|info|warn|error|fatal)$/], " +
  "[callee.object.name='console'][callee.property.name=/^(?:debug|info|warn|error)$/])";
const loggedIdentifier = `${logCall} > ObjectExpression > Property[kind='init'][method=false][computed=false]:matches([key.name=${identifierKey}], [key.value=${identifierKey}])`;
const logIdentifierCall = "[value.type='CallExpression'][value.callee.name='logIdentifier']";
const importsLogIdentifier =
  "ImportDeclaration[source.value='@/lib/security/log-identifier'] > ImportSpecifier[imported.name='logIdentifier'][local.name='logIdentifier']";
const identifierMessage =
  "logger/console must wrap identifier properties in logIdentifier (from @/lib/security/log-identifier) or omit them.";

// Pino's methods read their logger from `this`; a detached one throws once
// logging is on, which it is in production but not in tests.
const detachedLogMethod =
  "MemberExpression[object.name='logger'][computed=false][property.name=/^(?:trace|debug|info|warn|error|fatal)$/]:not(CallExpression > MemberExpression.callee)";

const arbitraryTextSize = "/(?<![\\w-])text-\\[\\d+(?:\\.\\d+)?(?:px|rem|em)\\]/";
const mutedAlias = "/(?<![\\w-])text-muted(?![-\\w])/";
const textSizeMessage =
  "Text sizes come from the frozen scale in globals.css, not text-[…] values.";
const mutedMessage = "Use text-muted-foreground rather than the duplicate text-muted token.";

const architectureSyntax = [
  { selector: `${loggedIdentifier}:not(${logIdentifierCall})`, message: identifierMessage },
  {
    selector: `Program:not(:has(${importsLogIdentifier})) ${loggedIdentifier}${logIdentifierCall}`,
    message: identifierMessage,
  },
  {
    selector: detachedLogMethod,
    message: "Call logger methods directly; a detached pino method loses its logger.",
  },
  { selector: `Literal[value=${arbitraryTextSize}]`, message: textSizeMessage },
  { selector: `TemplateElement[value.cooked=${arbitraryTextSize}]`, message: textSizeMessage },
  { selector: `Literal[value=${mutedAlias}]`, message: mutedMessage },
  { selector: `TemplateElement[value.cooked=${mutedAlias}]`, message: mutedMessage },
];
const sourceDocumentWrite = {
  selector:
    "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(?:insert|update|delete)$/] > Identifier[name='sourceDocuments']",
  message:
    "sourceDocuments writes must live in a registered source-document writer (registeredSourceDocumentWriters in eslint.config.mjs).",
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".next-cashier-*/**",
    ".worktrees/**",
    ".claude/**",
    ".tmp/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "public/sw.js",
  ]),
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["src/**/*.{ts,tsx,mts,mjs}"],
    rules: {
      "no-restricted-syntax": ["error", ...architectureSyntax, sourceDocumentWrite],
    },
  },
  {
    files: [...registeredSourceDocumentWriters, "src/persistence/postgres-migrations/**"],
    rules: {
      "no-restricted-syntax": ["error", ...architectureSyntax],
    },
  },
]);
