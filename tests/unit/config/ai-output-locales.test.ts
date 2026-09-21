import { describe, expect, it } from "vitest";
import {
  AI_OUTPUT_COPY,
  buildAiOutputLocaleInstruction,
  getAiOutputCopy,
} from "@/config/ai-output-locales";
import { AI_LANGUAGES } from "@/config/languages";

describe("AI output locales", () => {
  it("has deterministic user-facing copy for every selectable AI language", () => {
    expect(Object.keys(AI_OUTPUT_COPY).sort()).toEqual(
      AI_LANGUAGES.map((language) => language.value).sort()
    );

    for (const language of AI_LANGUAGES) {
      expect(
        Object.values(getAiOutputCopy(language.value)).every((value) => value.length > 0)
      ).toBe(true);
    }
  });

  it("describes the selected language as a native-user bookkeeping locale", () => {
    const instruction = buildAiOutputLocaleInstruction("zh-CN");

    expect(instruction).toContain("简体中文 (zh-CN)");
    expect(instruction).toContain("native user");
    expect(instruction).toContain("title, ledger_entries[].item_name");
    expect(instruction).toContain("higher priority than Additional Instructions");
  });

  it("uses English deterministic copy for an unrecognized locale", () => {
    // A ledger saved when the picker offered thirty languages keeps its value
    // in the database; it must degrade, not throw.
    expect(getAiOutputCopy("ja-JP").untitledDocument).toBe("Untitled document");
    expect(getAiOutputCopy("xx-TEST").untitledDocument).toBe("Untitled document");
  });
});
