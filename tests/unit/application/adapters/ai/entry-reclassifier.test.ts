import { beforeEach, describe, expect, it, vi } from "vitest";
import { entryReclassifierAdapter } from "@/application/adapters/ai/entry-reclassifier";
import type {
  ReclassificationCandidate,
  ReclassificationSubject,
} from "@/modules/ledger/application/reclassification-protocol";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@/lib/ai/openai-client", () => ({
  getOpenAIClient: () => ({ generateContent }),
}));

const candidates: ReclassificationCandidate[] = [
  { id: "cat-food", name: "吃喝", description: null },
  { id: "cat-home", name: "居家", description: null },
];
const subjects: ReclassificationSubject[] = [
  {
    ledgerEntryId: "entry-1",
    itemName: "Lunch",
    description: null,
    amount: "45.00",
    currency: "CNY",
    currentCategoryId: null,
    currentCategoryName: null,
  },
];

describe("entryReclassifierAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the model's indices back onto category ids", async () => {
    generateContent.mockResolvedValue({
      content: '```json\n{ "decisions": [{ "entry_index": 1, "category_index": 2 }] }\n```',
    });

    await expect(entryReclassifierAdapter.decide({ candidates, subjects })).resolves.toEqual({
      decisions: [{ ledgerEntryId: "entry-1", categoryId: "cat-home" }],
      confirmedCount: 0,
    });
  });

  it("rejects a response that is not JSON", async () => {
    generateContent.mockResolvedValue({ content: "I could not decide." });

    await expect(entryReclassifierAdapter.decide({ candidates, subjects })).rejects.toMatchObject({
      code: "AI_JSON_REPAIR_FAILED",
      statusCode: 502,
    });
  });

  it("rejects a response that does not match the schema", async () => {
    generateContent.mockResolvedValue({
      content: '{ "decisions": [{ "entry_index": 0, "category_index": 1 }] }',
    });

    await expect(entryReclassifierAdapter.decide({ candidates, subjects })).rejects.toMatchObject({
      code: "AI_JSON_REPAIR_FAILED",
      statusCode: 502,
    });
  });
});
