import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIMessageContentPart } from "@/lib/tasks/types";
import { entryReclassifierAdapter } from "@/application/adapters/ai/entry-reclassifier";
import type {
  ReclassificationCandidate,
  ReclassificationDocumentGroup,
} from "@/modules/ledger/application/reclassification-protocol";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@/lib/ai/openai-client", () => ({
  getOpenAIClient: () => ({ generateContent }),
}));

type SentMessage = { role: string; content: AIMessageContentPart[] };

const candidates: ReclassificationCandidate[] = [
  { id: "cat-food", name: "吃喝", description: null },
  { id: "cat-home", name: "居家", description: null },
];

function group(
  overrides: Partial<ReclassificationDocumentGroup> = {}
): ReclassificationDocumentGroup {
  return {
    sourceDocumentId: "doc-1",
    title: null,
    documentDate: null,
    inputText: null,
    storedFileIds: [],
    subjects: [
      {
        ledgerEntryId: "entry-1",
        itemName: "Lunch",
        description: null,
        amount: "45.00",
        currency: "CNY",
        currentCategoryId: null,
        currentCategoryName: null,
      },
    ],
    ...overrides,
  };
}

function sentMessages(): SentMessage[] {
  const call = generateContent.mock.calls[0];
  if (call == null) throw new Error("generateContent was not called");
  return call[1] as SentMessage[];
}

function sentText(): string {
  return sentMessages()
    .flatMap((message) => message.content)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

describe("entryReclassifierAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the model's indices back onto category ids", async () => {
    generateContent.mockResolvedValue({
      content: '```json\n{ "decisions": [{ "entry_index": 1, "category_index": 2 }] }\n```',
    });

    await expect(
      entryReclassifierAdapter.decide({ candidates, group: group(), images: [] })
    ).resolves.toEqual({
      decisions: [{ ledgerEntryId: "entry-1", categoryId: "cat-home" }],
      confirmedCount: 0,
    });
  });

  it("sends the document's own context, not just the entries", async () => {
    generateContent.mockResolvedValue({
      content: '{"decisions":[{"entry_index":1,"category_index":1}]}',
    });

    await entryReclassifierAdapter.decide({
      candidates,
      group: group({ title: "全家便利店", documentDate: "2026-09-10", inputText: "楼下买的" }),
      images: [],
    });

    const body = sentText();
    expect(body).toContain("document_title: 全家便利店");
    expect(body).toContain("document_date: 2026-09-10");
    expect(body).toContain("submitted_text: 楼下买的");
    expect(body).toContain("1. item_name: Lunch");
  });

  it("passes the document's images through as content parts, in order", async () => {
    generateContent.mockResolvedValue({
      content: '{"decisions":[{"entry_index":1,"category_index":1}]}',
    });

    await entryReclassifierAdapter.decide({
      candidates,
      group: group({ storedFileIds: ["f1", "f2"] }),
      images: [{ dataUrl: "data:image/jpeg;base64,AAA" }, { dataUrl: "data:image/png;base64,BBB" }],
    });

    const [message] = sentMessages();
    expect(message).toEqual({
      role: "user",
      content: [
        { type: "text", text: expect.stringContaining("attached_images: 2") },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } },
        { type: "image_url", image_url: { url: "data:image/png;base64,BBB" } },
      ],
    });
  });

  it("rejects a response that is not JSON", async () => {
    generateContent.mockResolvedValue({ content: "I could not decide." });

    await expect(
      entryReclassifierAdapter.decide({ candidates, group: group(), images: [] })
    ).rejects.toMatchObject({
      code: "ai_schema_invalid",
      statusCode: 502,
    });
  });

  it("rejects a response that does not match the schema", async () => {
    generateContent.mockResolvedValue({
      content: '{ "decisions": [{ "entry_index": 0, "category_index": 1 }] }',
    });

    await expect(
      entryReclassifierAdapter.decide({ candidates, group: group(), images: [] })
    ).rejects.toMatchObject({
      code: "ai_schema_invalid",
      statusCode: 502,
    });
  });
});
