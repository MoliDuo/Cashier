import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const channels = hex.match(/[\da-f]{2}/gi)!.map((channel) => Number.parseInt(channel, 16));
  return [channels[0]!, channels[1]!, channels[2]!];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(first: Rgb, second: Rgb): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/** color-mix(in srgb, <accent> <percent>%, <base>) */
function mix(accent: Rgb, percent: number, base: Rgb): Rgb {
  return accent.map((channel, index) =>
    Math.round((channel * percent + base[index]! * (100 - percent)) / 100)
  ) as Rgb;
}

/** The accent share of a heatmap level written as color-mix(in srgb, var(--moli-accent) N%, var(--moli-<base>)). */
function share(globals: string, level: number, base: string): number {
  const found = new RegExp(
    `--heatmap-${level}:\\s*color-mix\\(in srgb, var\\(--moli-accent\\) (\\d+)%, var\\(--moli-${base}\\)\\)`
  ).exec(globals);
  if (found == null) throw new Error(`--heatmap-${level} is not a mix of the accent and ${base}`);
  return Number(found[1]);
}

/** The value of a `--moli-*` token inside the first rule that matches `selector`. */
function token(css: string, selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  return /(#[\da-f]{6})/i.exec(block.slice(block.indexOf(`--moli-${name}:`)))![1]!;
}

describe("heatmap color contrast", () => {
  const root = process.cwd();
  const tokens = fs.readFileSync(path.resolve(root, "src/app/moli-tokens.css"), "utf8");
  const globals = fs.readFileSync(path.resolve(root, "src/app/globals.css"), "utf8");

  it("steps from the secondary surface up to the accent and past it", () => {
    expect(globals).toMatch(/--heatmap-0:\s*var\(--moli-surface2\);/);
    expect(globals).toMatch(/--heatmap-4:\s*var\(--moli-accent\);/);
    const steps = [1, 2, 3].map((level) => share(globals, level, "surface2"));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(steps.at(-1)).toBeLessThan(100);
    expect(share(globals, 5, "text")).toBeLessThan(100);
  });

  it("meets WCAG AA for every light and dark heatmap level", () => {
    const schemes = [
      {
        accent: token(tokens, '[data-app="cashier"]', "accent"),
        accentFg: token(tokens, '[data-app="cashier"]', "accent-fg"),
        surface2: token(tokens, ":root", "surface2"),
        text: token(tokens, ":root", "text"),
      },
      {
        accent: token(tokens, ':root[data-theme="dark"] [data-app="cashier"]', "accent"),
        accentFg: token(tokens, ':root[data-theme="dark"] [data-app="cashier"]', "accent-fg"),
        surface2: token(tokens, ':root[data-theme="dark"]', "surface2"),
        text: token(tokens, ':root[data-theme="dark"]', "text"),
      },
    ];

    for (const scheme of schemes) {
      const accent = parseHex(scheme.accent);
      const surface2 = parseHex(scheme.surface2);
      const text = parseHex(scheme.text);
      const backgrounds: Rgb[] = [
        surface2,
        mix(accent, share(globals, 1, "surface2"), surface2),
        mix(accent, share(globals, 2, "surface2"), surface2),
        mix(accent, share(globals, 3, "surface2"), surface2),
        accent,
        mix(accent, share(globals, 5, "text"), text),
      ];
      for (const [level, background] of backgrounds.entries()) {
        const foreground = parseHex(level >= 4 ? scheme.accentFg : scheme.text);
        expect(contrast(background, foreground)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
