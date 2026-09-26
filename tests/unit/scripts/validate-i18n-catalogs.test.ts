import { describe, expect, it } from "vitest";
import {
  collectTranslationUsage,
  tokenize,
  validateCatalog,
} from "../../../scripts/validate-i18n-catalogs.mjs";

const catalog = JSON.stringify({
  Ledger: {
    title: "账本",
    empty: "{count, plural, =0 {空} other {# 条}}",
    filters: { all: "全部", recent: "最近" },
  },
  Status: { pending: "处理中", done: "完成" },
  AuthEmail: { subject: "登录" },
});

function errorsFor(source: string, catalogContent = catalog): string[] {
  return validateCatalog(catalogContent, [{ fileName: "src/probe.tsx", source }]);
}

/** Reads every key of the fixture catalog, so each test can take one away. */
const readsEverything = `
import { useTranslations } from "next-intl";
const t = useTranslations("Ledger");
t("title");
t.rich("empty", { count: 1 });
t.raw("filters");
const status = useTranslations("Status");
status(\`\${state}\`);
const states = ["pending", "done"];
`;

describe("validateCatalog", () => {
  it("accepts a catalog whose every key is read", () => {
    expect(errorsFor(readsEverything)).toEqual([]);
  });

  it("reports a key nothing reads", () => {
    const source = readsEverything.replace('t("title");', "");

    expect(errorsFor(source)).toEqual(["zh.json: unused message key Ledger.title"]);
  });

  it("counts a key read through a getTranslations namespace", () => {
    const source = readsEverything
      .replace('t("title");', "")
      .concat(
        'import { getTranslations as load } from "next-intl/server";\n',
        'const server = await load({ locale, namespace: "Ledger" });\nserver("title");\n'
      );

    expect(errorsFor(source)).toEqual([]);
  });

  it("keeps a dynamically read key used when its last segment is a literal", () => {
    const source = readsEverything.replace(
      'const states = ["pending", "done"];',
      'const states = ["pending"];'
    );

    expect(errorsFor(source)).toEqual(["zh.json: unused message key Status.done"]);
  });

  it("does not read keys out of comments", () => {
    const source = readsEverything.replace('t("title");', '// t("title");\n/* t("title") */');

    expect(errorsFor(source)).toEqual(["zh.json: unused message key Ledger.title"]);
  });

  it("treats a non-literal argument as dynamic rather than static", () => {
    const source = readsEverything.replace('t("title");', 't(`ti${"tle"}`);');

    expect(errorsFor(source)).toEqual(["zh.json: unused message key Ledger.title"]);
  });

  it("reports invalid ICU syntax", () => {
    const broken = catalog.replace("# 条}}", "# 条}");

    expect(errorsFor(readsEverything, broken)).toContainEqual(
      expect.stringContaining("zh.json:Ledger.empty: invalid ICU message")
    );
  });

  it("reports a full key rendered as a raw string", () => {
    const source = `${readsEverything}\nexport const label = <p>{"Ledger.title"}</p>;\n`;

    expect(errorsFor(source)).toEqual([
      "src/probe.tsx:11: raw translation key rendered directly: Ledger.title",
    ]);
  });

  it("allows a dotted namespace passed to the translator itself", () => {
    const source = `${readsEverything}\nconst f = useTranslations("Ledger.filters");\n`;

    expect(errorsFor(source)).toEqual([]);
  });

  it("reports duplicate top-level keys and invalid JSON", () => {
    expect(errorsFor(readsEverything, '{\n  "A": {},\n  "A": {}\n}')).toContainEqual(
      "zh.json: duplicate top-level keys detected: A"
    );
    expect(errorsFor(readsEverything, "{")).toContainEqual(
      expect.stringContaining("zh.json: invalid JSON")
    );
  });
});

describe("collectTranslationUsage", () => {
  it("binds translators through aliases, awaits and type annotations", () => {
    const usage = collectTranslationUsage(`
      import { useTranslations as useT, type Messages } from "next-intl";
      import { createTranslator } from "next-intl";
      const a = useT("A");
      const b: Translator = await (createTranslator({ messages, namespace: "B" }));
      const root = createTranslator({ messages });
      a("one"); a.has("two"); b.markup("three", {}); root("C.four");
      a.other("ignored"); x.a("ignored"); other("ignored"); function a(key) {}
    `);

    expect(usage.staticKeys).toEqual(["A.one", "A.two", "B.three", "C.four"]);
  });

  it("follows a rebinding in source order", () => {
    const usage = collectTranslationUsage(`
      let t = useTranslations("A"); t("one");
      t = something(); t("two");
      const t = useTranslations("B"); t("three");
    `);

    expect(usage.staticKeys).toEqual(["A.one", "A.two", "B.three"]);
  });
});

describe("tokenize", () => {
  const strings = (source: string) =>
    tokenize(source)
      .filter((token) => token.type === "string")
      .map((token) => token.value);

  it("reads strings, escapes and plain templates as literals", () => {
    expect(strings(`a("x\\"y", 'z', \`w\`, \`p\${q}r\`, "\\u0041")`)).toEqual([
      'x"y',
      "z",
      "w",
      "A",
    ]);
  });

  it("finds literals inside template substitutions", () => {
    expect(strings("`a ${f({ k: 'inner' })} b ${`nested`}`")).toEqual(["inner", "nested"]);
  });

  it("skips comments, regular expressions and JSX closing tags", () => {
    const source = `
      // "comment"
      /* 'block' */
      const re = /["']/g, n = 4 / 2 / 1;
      const el = <a href="https://x">label</a>;
      if (/x/.test(s)) f("after");
    `;

    expect(strings(source)).toEqual(["https://x", "after"]);
  });
});
