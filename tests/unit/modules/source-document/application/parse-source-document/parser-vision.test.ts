import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeParser } from "@/modules/source-document/application/parse-source-document/parser";
import type { AIContext, AIGenerateOptions } from "@/lib/tasks/types";

const SIMPLE_SUCCESS_RESPONSE = {
  outcome: "success",
  title: "Test Restaurant",
  receipt_count: 1,
  receipt_totals: [{ receipt_index: 0, amount: "45.00", currency: "CNY" }],
  ledger_entries: [
    {
      receipt_index: 0,
      item_name: "Lunch set",
      amount: "45.00",
      currency: "CNY",
      category_index: 1,
      notes: null,
    },
  ],
  order_adjustments: [],
  reasoning: "Single item receipt",
};

function createMockAI(response: unknown = SIMPLE_SUCCESS_RESPONSE): AIContext {
  return {
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(response),
    }),
  };
}

function getFirstGenerateCall(generate: ReturnType<typeof vi.fn>): AIGenerateOptions {
  const firstCall = generate.mock.calls[0]?.[0];
  if (firstCall == null) {
    throw new Error("Expected AI generate to be called");
  }
  return firstCall as AIGenerateOptions;
}

describe("executeParser — single-pass receipt parser", () => {
  let mockAI: AIContext;

  beforeEach(() => {
    mockAI = createMockAI();
  });

  it("returns NormalizedParseOutput with outcome, title, entries, adjustments", async () => {
    const result = await executeParser(
      { evidence: { images: [{ dataUrl: "data:image/jpeg;base64,abc" }] }, originalCategories: [] },
      mockAI
    );

    expect(result.outcome).toBe("success");
    expect(result.title).toBe("Test Restaurant");
    expect(result.receipt_count).toBe(1);
    expect(result.receipt_totals).toHaveLength(1);
    expect(result.ledger_entries).toHaveLength(1);
    expect(result.order_adjustments).toEqual([]);
  });

  it("preserves order_adjustments with negative amounts", async () => {
    const aiWithAdjustment = createMockAI({
      ...SIMPLE_SUCCESS_RESPONSE,
      order_adjustments: [
        { receipt_index: 0, item_name: "Discount", amount: "-5.00", currency: "CNY" },
      ],
    });

    const result = await executeParser(
      { evidence: { images: [{ dataUrl: "data:image/jpeg;base64,abc" }] }, originalCategories: [] },
      aiWithAdjustment
    );

    expect(result.order_adjustments).toHaveLength(1);
    expect(result.order_adjustments[0]?.amount).toBe("-5.00");
  });

  it("instructs the model to accept transaction-linked prices and normalize debit display signs", async () => {
    await executeParser({ originalCategories: [] }, mockAI);

    const prompt = getFirstGenerateCall(mockAI.generate as ReturnType<typeof vi.fn>).prompt;
    expect(prompt).toContain("Valid evidence isn't limited to completed receipts/invoices");
    expect(prompt).toContain("A displayed minus sign on a debit/payment/charge");
    expect(prompt).toContain("balance, available credit, coupon value, price range");
  });

  // === Model selection ===

  it("uses vision model when image evidence is provided", async () => {
    await executeParser(
      { evidence: { images: [{ dataUrl: "data:image/jpeg;base64,abc" }] }, originalCategories: [] },
      mockAI
    );

    expect(getFirstGenerateCall(mockAI.generate as ReturnType<typeof vi.fn>).model).toBe("vision");
  });

  it("passes preloaded image evidence to the AI", async () => {
    await executeParser(
      {
        evidence: { images: [{ dataUrl: "data:image/png;base64,STORED" }] },
        originalCategories: [],
      },
      mockAI
    );

    const call = getFirstGenerateCall(mockAI.generate as ReturnType<typeof vi.fn>);
    expect(call.messages[0]?.content).toEqual([
      { type: "text", text: "Please parse this source document." },
      { type: "image_url", image_url: { url: "data:image/png;base64,STORED" } },
    ]);
  });

  it("passes user content through messages instead of stored file evidence", async () => {
    const generate = vi.fn(async (options: AIGenerateOptions) => {
      const firstMessage = options.messages[0];
      expect(firstMessage).toBeDefined();
      expect(firstMessage?.role).toBe("user");
      expect(Array.isArray(firstMessage?.content)).toBe(true);

      const content = firstMessage?.content;
      if (!Array.isArray(content)) {
        throw new Error("Expected multimodal user content array");
      }

      expect(content[0]).toEqual({ type: "text", text: "Please parse this source document." });
      expect(content[1]).toEqual({
        type: "image_url",
        image_url: { url: "data:image/png;base64,STORED" },
      });

      return {
        content: JSON.stringify(SIMPLE_SUCCESS_RESPONSE),
      };
    });

    await executeParser(
      {
        evidence: { images: [{ dataUrl: "data:image/png;base64,STORED" }] },
        originalCategories: [],
      },
      { generate }
    );

    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("uses text model when only text is provided", async () => {
    await executeParser({ text: "Taxi fare SGD 28.00", originalCategories: [] }, mockAI);

    expect(getFirstGenerateCall(mockAI.generate as ReturnType<typeof vi.fn>).model).toBe("text");
  });

  it("uses vision model for mixed text+image input", async () => {
    await executeParser(
      {
        text: "meal",
        evidence: { images: [{ dataUrl: "data:image/jpeg;base64,abc" }] },
        originalCategories: [],
      },
      mockAI
    );

    expect(getFirstGenerateCall(mockAI.generate as ReturnType<typeof vi.fn>).model).toBe("vision");
  });

  // === Outcome branches ===

  it("returns invalid outcome without a reason when AI omits it", async () => {
    const aiInvalid = createMockAI({
      ...SIMPLE_SUCCESS_RESPONSE,
      outcome: "invalid",
      ledger_entries: [],
      receipt_totals: [],
    });

    const result = await executeParser({ text: "random text", originalCategories: [] }, aiInvalid);

    expect(result.outcome).toBe("invalid");
  });

  it("preserves the invalid reason reported by AI", async () => {
    const aiInvalid = createMockAI({
      ...SIMPLE_SUCCESS_RESPONSE,
      outcome: "invalid",
      invalid_reason: "Blurry image",
      ledger_entries: [],
      receipt_totals: [],
    });

    const result = await executeParser(
      { evidence: { images: [{ dataUrl: "data:image/jpeg;base64,abc" }] }, originalCategories: [] },
      aiInvalid
    );

    expect(result.outcome).toBe("invalid");
    expect(result.invalid_reason).toBe("Blurry image");
  });

  // === Prompt contains required sections ===

  it("injects category list into prompt when categories are provided", async () => {
    await executeParser(
      {
        text: "coffee 10 USD",
        originalCategories: [{ name: "Food", description: "Meals and snacks" }],
      },
      mockAI
    );

    expect(getFirstGenerateCall(mockAI.generate as ReturnType<typeof vi.fn>).prompt).toContain(
      "Food"
    );
  });

  it("prompt contains expense evidence parser identifier", async () => {
    await executeParser({ text: "coffee 10 USD", originalCategories: [] }, mockAI);

    expect(getFirstGenerateCall(mockAI.generate as ReturnType<typeof vi.fn>).prompt).toContain(
      "expense evidence parser"
    );
  });

  it("uses the v11 rules for mixed refund cards and bookkeeping totals", async () => {
    await executeParser({ text: "payment feed", originalCategories: [] }, mockAI);

    const prompt = getFirstGenerateCall(mockAI.generate as ReturnType<typeof vi.fn>).prompt;
    expect(prompt).toContain("refund/credit note is the only thing on it");
    expect(prompt).toContain("skip the refund card entirely");
    expect(prompt).toContain("Ignore running balances and day/period summary headers");
    expect(prompt).toContain("No receipt total is required");
  });

  it("keeps the v11 rules in a stable prefix before per-request context", async () => {
    await executeParser(
      {
        text: "Coffee 10 USD",
        originalCategories: [{ name: "Food" }],
        aiLanguage: "en-US",
        aiCustomPrompt: "Use my preferred wording.",
        preferredCurrencies: ["USD"],
      },
      mockAI
    );

    const prompt = getFirstGenerateCall(mockAI.generate as ReturnType<typeof vi.fn>).prompt ?? "";
    const fixedRuleIndex = prompt.indexOf("skip the refund card entirely");
    const dynamicContextIndex = prompt.indexOf("### Expense Categories");

    expect(fixedRuleIndex).toBeGreaterThan(-1);
    expect(dynamicContextIndex).toBeGreaterThan(fixedRuleIndex);
    expect(prompt.indexOf("### Preferred Currencies")).toBeGreaterThan(fixedRuleIndex);
    expect(prompt.indexOf("### Additional Instructions")).toBeGreaterThan(fixedRuleIndex);
    expect(prompt.indexOf("### Document Text")).toBeGreaterThan(fixedRuleIndex);
    expect(prompt.indexOf("### Mandatory Output Locale")).toBeGreaterThan(fixedRuleIndex);
  });

  it("makes the native-user locale override a conflicting custom prompt", async () => {
    await executeParser(
      {
        text: "Coffee 10 USD",
        originalCategories: [],
        aiLanguage: "zh-CN",
        aiCustomPrompt: "Write every ledger field in English.",
      },
      mockAI
    );

    const prompt = getFirstGenerateCall(mockAI.generate as ReturnType<typeof vi.fn>).prompt ?? "";
    const customPromptIndex = prompt.indexOf("Write every ledger field in English.");
    const localePolicyIndex = prompt.indexOf("Mandatory Output Locale");

    expect(customPromptIndex).toBeGreaterThan(-1);
    expect(localePolicyIndex).toBeGreaterThan(customPromptIndex);
    expect(prompt).toContain("简体中文 (zh-CN)");
    expect(prompt).toContain("order_adjustments[].item_name");
    expect(prompt).toContain("Preserve merchant names, brand names, product proper names");
  });

  it("includes the shared title policy and keeps language above ledger prompts", async () => {
    await executeParser(
      {
        text: "Coffee 10 USD",
        originalCategories: [],
        aiLanguage: "en-US",
        aiCustomPrompt: "Always include the amount in the title.",
      },
      mockAI
    );

    const prompt = getFirstGenerateCall(mockAI.generate as ReturnType<typeof vi.fn>).prompt ?? "";
    expect(prompt).toContain("### Title");
    expect(prompt).toContain("merchant/service-first");
    expect(prompt).toContain("No amounts, dates, or payment status");
    expect(prompt).toContain("at most 200 Unicode characters");
    expect(prompt).toContain("facts/structure of the source document");
    expect(prompt).toContain("mandatory output locale below");
    expect(prompt).toContain("ledger owner's Additional Instructions");
    // The ledger prompt cannot override the output language or hard constraints.
    expect(prompt.indexOf("Mandatory Output Locale")).toBeGreaterThan(
      prompt.indexOf("Always include the amount in the title.")
    );
  });

  // === Multi-image ===

  it("handles multiple images without error", async () => {
    const result = await executeParser(
      {
        evidence: {
          images: [
            { dataUrl: "data:image/jpeg;base64,abc" },
            { dataUrl: "data:image/jpeg;base64,def" },
          ],
        },
        originalCategories: [],
      },
      mockAI
    );
    expect(result.outcome).toBe("success");
  });
});
