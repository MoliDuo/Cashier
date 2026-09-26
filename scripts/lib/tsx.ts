/**
 * The Node arguments that run a repository script as the npm scripts do: through
 * tsx, which resolves the `@/` alias, under the `react-server` condition so
 * the `server-only` modules it reaches load outside Next.js.
 */
export function tsxArgs(script: string, ...args: string[]): string[] {
  return ["--conditions=react-server", "--import", "tsx", script, ...args];
}
