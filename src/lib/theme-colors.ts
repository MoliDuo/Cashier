/**
 * The page background in each color scheme, equal to `--moli-bg` in moli-tokens.css. Browser chrome
 * and the web app manifest take a literal color and cannot read a CSS variable, so this is the one
 * place outside the token files that repeats the values.
 */
export const THEME_COLOR = { light: "#fafafa", dark: "#0a0a0a" } as const;
