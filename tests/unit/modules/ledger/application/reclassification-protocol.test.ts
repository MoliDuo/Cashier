import { describe, expect, it } from "vitest";
import {
  buildReclassificationPrompt,
  buildReclassificationSubjectsMessage,
  resolveReclassificationDecisions,
  type ReclassificationCandidate,
  type ReclassificationSubject,
} from "@/modules/ledger/application/reclassification-protocol";

const candidates: ReclassificationCandidate[] = [
  { id: "cat-food", name: "吃喝", description: "正餐与饮品" },
  { id: "cat-home", name: "居家", description: null },
  { id: "cat-health", name: "健康", description: "医疗与健身" },
];

function subject(overrides: Partial<ReclassificationSubject> = {}): ReclassificationSubject {
  return {
    ledgerEntryId: "entry-1",
    itemName: "Lunch set",
    description: null,
    amount: "45.00",
    currency: "CNY",
    currentCategoryId: null,
    currentCategoryName: null,
    ...overrides,
  };
}

describe("buildReclassificationPrompt", () => {
  it("numbers candidates from 1 and offers 0 for an entry that fits nothing", () => {
    const prompt = buildReclassificationPrompt({ candidates });

    expect(prompt).toContain("1. 吃喝 — 正餐与饮品");
    expect(prompt).toContain("2. 居家");
    expect(prompt).toContain("3. 健康 — 医疗与健身");
    expect(prompt).toContain("Use category_index 0 when an entry does not clearly belong");
  });

  it("carries the ledger's own instructions when it has any", () => {
    expect(buildReclassificationPrompt({ candidates, customPrompt: "只按商家判断" })).toContain(
      "只按商家判断"
    );
    expect(buildReclassificationPrompt({ candidates, customPrompt: "" })).not.toContain(
      "Additional Instructions"
    );
    expect(buildReclassificationPrompt({ candidates })).not.toContain("Additional Instructions");
  });

  it("says nothing about an output locale", () => {
    // The response is integers; an output-locale directive would be noise.
    const prompt = buildReclassificationPrompt({ candidates });

    expect(prompt).not.toContain("Mandatory Output Locale");
    expect(prompt).not.toContain("Output Locale");
  });
});

describe("buildReclassificationSubjectsMessage", () => {
  it("numbers entries from 1 and shows where each one sits today", () => {
    const message = buildReclassificationSubjectsMessage({
      subjects: [
        subject({ ledgerEntryId: "a", itemName: "Lunch", amount: "45.00", currency: "CNY" }),
        subject({
          ledgerEntryId: "b",
          itemName: "Taxi",
          amount: "18.00",
          currency: null,
          currentCategoryName: "出行",
        }),
      ],
    });

    expect(message).toContain(
      "1. item_name: Lunch | amount: 45.00 CNY | current_category: uncategorized"
    );
    expect(message).toContain("2. item_name: Taxi | amount: 18.00 | current_category: 出行");
  });
});

describe("resolveReclassificationDecisions", () => {
  const subjects = [
    subject({ ledgerEntryId: "a", currentCategoryId: null }),
    subject({ ledgerEntryId: "b", currentCategoryId: "cat-home" }),
    subject({ ledgerEntryId: "c", currentCategoryId: "cat-food" }),
  ];

  it("emits one decision per entry the model placed elsewhere", () => {
    expect(
      resolveReclassificationDecisions({
        subjects,
        candidates,
        response: { decisions: [{ entry_index: 1, category_index: 1 }] },
      })
    ).toEqual({ decisions: [{ ledgerEntryId: "a", categoryId: "cat-food" }], confirmedCount: 0 });
  });

  it("counts a decision that matches the entry's current category as confirmed", () => {
    expect(
      resolveReclassificationDecisions({
        subjects,
        candidates,
        response: { decisions: [{ entry_index: 2, category_index: 2 }] },
      })
    ).toEqual({ decisions: [], confirmedCount: 1 });
  });

  it("leaves an entry alone rather than guessing", () => {
    const cases: readonly {
      label: string;
      decisions: { entry_index: number; category_index: number }[];
    }[] = [
      { label: "an explicit 0", decisions: [{ entry_index: 1, category_index: 0 }] },
      { label: "a category past the list", decisions: [{ entry_index: 1, category_index: 9 }] },
      { label: "an entry past the slice", decisions: [{ entry_index: 9, category_index: 1 }] },
    ];
    for (const testCase of cases) {
      expect(
        resolveReclassificationDecisions({
          subjects,
          candidates,
          response: { decisions: testCase.decisions },
        }),
        testCase.label
      ).toEqual({ decisions: [], confirmedCount: 0 });
    }
  });

  it("keeps the first decision when the model repeats an entry", () => {
    expect(
      resolveReclassificationDecisions({
        subjects,
        candidates,
        response: {
          decisions: [
            { entry_index: 1, category_index: 2 },
            { entry_index: 1, category_index: 3 },
          ],
        },
      })
    ).toEqual({ decisions: [{ ledgerEntryId: "a", categoryId: "cat-home" }], confirmedCount: 0 });
  });

  it("ignores entries the model never mentioned", () => {
    expect(
      resolveReclassificationDecisions({
        subjects,
        candidates,
        response: { decisions: [{ entry_index: 3, category_index: 3 }] },
      })
    ).toEqual({ decisions: [{ ledgerEntryId: "c", categoryId: "cat-health" }], confirmedCount: 0 });
  });
});
