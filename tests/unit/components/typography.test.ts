import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { textRoleClassName, type TextRole } from "@/components/typography";

/**
 * The role table exists so that the same kind of text is the same size
 * everywhere. These tests hold that property, not the spellings: a role may be
 * retuned without touching them, but a role that carries two sizes, collides
 * with another role, or stops yielding to its caller will fail.
 */
const ROLES = Object.keys({
  pageTitle: true,
  dialogTitle: true,
  sectionTitle: true,
  cardTitle: true,
  body: true,
  bodyStrong: true,
  bodyMuted: true,
  meta: true,
  micro: true,
  provisional: true,
  // `satisfies` makes tsc the guard: a role added to the type and not to this
  // list stops the build rather than quietly going untested.
} satisfies Record<TextRole, true>) as TextRole[];

/** Every `text-<size>` token a role resolves to — colours are not sizes. */
function sizesOf(className: string): string[] {
  return className
    .split(" ")
    .filter((token) => /^text-(xs|sm|base|lg|xl|2xl|3xl|micro)$/.test(token));
}

describe("cn", () => {
  // tailwind-merge reads an unregistered `text-<size>` as a colour and drops it
  // when a colour follows, so `--text-micro` has to be registered explicitly.
  it("keeps the custom text-micro size when a colour follows", () => {
    expect(cn("text-micro", "text-muted-foreground")).toBe("text-micro text-muted-foreground");
  });
});

describe("textRoleClassName", () => {
  it("gives every role exactly one size", () => {
    for (const role of ROLES) {
      expect({ role, sizes: sizesOf(textRoleClassName(role)) }).toEqual({
        role,
        sizes: [expect.any(String)],
      });
    }
  });

  it("gives every role a purpose of its own", () => {
    const byClassName = new Map<string, TextRole>();
    for (const role of ROLES) {
      const className = textRoleClassName(role);
      const twin = byClassName.get(className);
      // Two roles that render identically are one role with two names, which is
      // what the table was introduced to remove.
      expect({ role, twin }).toEqual({ role, twin: undefined });
      byClassName.set(className, role);
    }
    expect(byClassName.size).toBe(ROLES.length);
  });

  it("stays inside the frozen scale, which has no 20px tier", () => {
    // The scale is deliberately gapped: `text-xl` exists in Tailwind but no
    // role may reach for it, or the page-title and section-title tiers stop
    // being one step apart.
    const scale = ["text-micro", "text-xs", "text-sm", "text-base", "text-lg", "text-2xl"];
    for (const role of ROLES) {
      for (const size of sizesOf(textRoleClassName(role))) {
        expect({ role, size, inScale: scale.includes(size) }).toEqual({
          role,
          size,
          inScale: true,
        });
      }
    }
  });

  it("lets the caller override the role's size and colour", () => {
    for (const role of ROLES) {
      const overridden = textRoleClassName(role, "text-2xl text-destructive");
      expect(sizesOf(overridden)).toEqual(["text-2xl"]);
      expect(overridden).toContain("text-destructive");
      expect(overridden).not.toContain("text-muted-foreground");
    }
  });

  it("keeps caller classes that the role says nothing about", () => {
    const className = textRoleClassName("meta", "truncate");
    expect(className.split(" ")).toContain("truncate");
    expect(sizesOf(className)).toEqual(sizesOf(textRoleClassName("meta")));
  });
});
