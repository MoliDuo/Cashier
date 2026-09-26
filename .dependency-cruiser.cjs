const fs = require("node:fs");
const path = require("node:path");

/** A `@/x` directory or single-file module, as a resolved path. */
const moduleAt = (prefix) => `^${prefix}(?:/|\\.[^/.]+$)`;
/** An npm package, resolved into node_modules (or its @types) or left unresolved. */
const packages = (names) => [
  `(?:^|/)node_modules/(?:@types/)?(?:${names})/`,
  `^(?:${names})(?:/|$)`,
];

const persistence = moduleAt("src/persistence");
const libDb = moduleAt("src/lib/db");
const s3 = moduleAt("src/lib/storage/s3");
const openaiClient = moduleAt("src/lib/ai/openai-client");
const serverFlows = moduleAt("src/server");
const moduleServer = moduleAt("src/modules/[^/]+/server");
const moduleUi = moduleAt("src/modules/[^/]+/(?:ui|hooks)");
const moduleServerActions = moduleAt("src/modules/[^/]+/server-actions");
const app = moduleAt("src/app");
const providerSdks = packages("pg|openai|resend|drizzle-orm|@aws-sdk/[^/]+");
const frameworks = packages("next|next-auth|@auth/[^/]+|server-only");
const aiAndMailSdks = packages("ai|openai|resend|@(?:ai-sdk|aws-sdk|google|anthropic-ai)/[^/]+");
const dataAccess = [libDb, persistence, ...providerSdks];
const actionsFile = "actions(?:\\.[^/.]+|/index\\.[^/.]+)$";
const actionsBarrel = `(?:^|/)${actionsFile}`;
const moduleActionsBarrel = `^src/modules/[^/]+/${actionsFile}`;

/** Whether the module prologue opens with `"use client"` after comments. */
function hasClientDirective(source) {
  const prologue = source.replace(/^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, "");
  return /^(?:"use client"|'use client')/.test(prologue);
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:tsx?|mts|mjs)$/.test(entry.name) ? [absolute] : [];
  });
}

/**
 * `import("…")` type references have never been checked, and three of them
 * reach from src/lib and src/persistence into modules. They stay outside the
 * rules until those are fixed.
 */
const importTypeReference = ["type-import"];
const onto = (paths) => ({ path: paths, dependencyTypesNot: importTypeReference });

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clientComponents = sourceFiles(path.join(__dirname, "src"))
  .filter((file) => hasClientDirective(fs.readFileSync(file, "utf8")))
  .map((file) => `^${escape(path.relative(__dirname, file).split(path.sep).join("/"))}$`);

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-import-cycles",
      comment: "Modules and src/server may call each other only without file-level import cycles.",
      severity: "error",
      from: { path: "^src/" },
      to: {
        circular: true,
        dependencyTypesNot: importTypeReference,
        viaOnly: { dependencyTypesNot: importTypeReference },
      },
    },
    {
      name: "modules-not-app",
      comment: "Modules must not import app entrypoints.",
      severity: "error",
      from: { path: "^src/modules/" },
      to: onto(app),
    },
    {
      name: "lib-not-feature-code",
      comment: "src/lib must not import modules, app, or src/server.",
      severity: "error",
      from: { path: "^src/lib/" },
      to: onto([moduleAt("src/modules"), app, serverFlows]),
    },
    {
      name: "persistence-not-feature-code",
      comment: "Persistence must not import modules or src/server.",
      severity: "error",
      from: { path: "^src/persistence/" },
      to: onto([moduleAt("src/modules"), serverFlows]),
    },
    {
      name: "modules-not-workspace",
      comment: "Domain modules must not depend on workspace orchestration.",
      severity: "error",
      from: { path: "^src/modules/", pathNot: "^src/modules/workspace/" },
      to: onto(moduleAt("src/modules/workspace")),
    },
    {
      name: "domain-stays-pure",
      comment: "Domain code has no database, providers, frameworks, or server code.",
      severity: "error",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: onto([...dataAccess, ...frameworks, serverFlows, moduleServer]),
    },
    {
      name: "server-flows-not-entrypoints",
      comment: "src/server must not import app entrypoints, server actions, or UI.",
      severity: "error",
      from: { path: "^src/server/" },
      to: onto([app, moduleServerActions, moduleUi]),
    },
    {
      name: "entrypoints-call-server-functions",
      comment:
        "Server actions and API routes call server functions, not the database or providers.",
      severity: "error",
      from: { path: ["^src/modules/[^/]+/server-actions/", "^src/app/api/"] },
      to: onto([...dataAccess, s3, openaiClient, ...aiAndMailSdks]),
    },
    {
      name: "providers-not-module-ui",
      comment: "src/components/providers must not import module UI.",
      severity: "error",
      from: { path: "^src/components/providers/" },
      to: onto(moduleUi),
    },
    {
      name: "client-not-server-code",
      comment: '"use client" files must not import server-only code.',
      severity: "error",
      from: { path: clientComponents },
      to: onto([libDb, persistence, serverFlows, moduleServer, s3, openaiClient]),
    },
    {
      name: "client-not-actions-barrel",
      comment: '"use client" files import concrete server actions, not an actions barrel.',
      severity: "error",
      from: { path: clientComponents },
      to: onto(actionsBarrel),
    },
    {
      name: "api-routes-not-server-actions",
      comment: "API routes must not import module server actions or actions barrels.",
      severity: "error",
      from: { path: "^src/app/api/" },
      to: onto([moduleServerActions, moduleActionsBarrel]),
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
  },
};
