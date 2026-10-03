/**
 * Where to land after signing in. Only a same-site path is honoured: anything
 * that a browser could read as another origin (`//host`, `/\host`), carries a
 * control character, or is not a path at all becomes "/".
 */
export function sanitizeCallbackPath(value: string | null | undefined): string {
  if (value == null || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  return value;
}
