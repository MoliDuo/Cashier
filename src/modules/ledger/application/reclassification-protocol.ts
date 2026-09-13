import { z } from "zod";

/**
 * The wire protocol between the ledger and the model for a reclassification
 * run. Deliberately index-based, mirroring the parser's `category_index`
 * protocol: models copy small integers far more reliably than UUIDs.
 *
 * Pure functions only — no ports, no adapters, no locale instruction. The
 * response carries integers and nothing a user reads, so an output-locale
 * directive would be noise.
 */

export interface ReclassificationCandidate {
  id: string;
  name: string;
  description: string | null;
}

export interface ReclassificationSubject {
  ledgerEntryId: string;
  itemName: string;
  description: string | null;
  amount: string;
  currency: string | null;
  /** Context for the model; never a field it may change. */
  currentCategoryId: string | null;
  currentCategoryName: string | null;
}

export const reclassificationResponseSchema = z.object({
  decisions: z.array(
    z.object({
      entry_index: z.number().int().min(1),
      category_index: z.number().int().min(0),
    })
  ),
});

export type ReclassificationResponse = z.infer<typeof reclassificationResponseSchema>;

export interface ResolvedReclassification {
  decisions: { ledgerEntryId: string; categoryId: string }[];
  /** Entries the model placed in the category they already had. */
  confirmedCount: number;
}

function candidateLine(candidate: ReclassificationCandidate, index: number): string {
  const description =
    candidate.description != null && candidate.description !== ""
      ? ` — ${candidate.description}`
      : "";
  return `${index + 1}. ${candidate.name}${description}`;
}

function subjectLine(subject: ReclassificationSubject, index: number): string {
  const fields = [
    `item_name: ${subject.itemName}`,
    `amount: ${subject.amount}${subject.currency == null ? "" : ` ${subject.currency}`}`,
  ];
  if (subject.description != null && subject.description !== "") {
    fields.push(`notes: ${subject.description}`);
  }
  fields.push(`current_category: ${subject.currentCategoryName ?? "uncategorized"}`);
  return `${index + 1}. ${fields.join(" | ")}`;
}

/** The system prompt: the candidate list and the rules for picking one. */
export function buildReclassificationPrompt(input: {
  candidates: readonly ReclassificationCandidate[];
  customPrompt?: string;
}): string {
  const candidateSection = input.candidates.map(candidateLine).join("\n");
  const customSection =
    input.customPrompt != null && input.customPrompt !== ""
      ? `\n### Additional Instructions\n${input.customPrompt}\n`
      : "";

  return `You are an expense categorizer. You are given a list of candidate categories and a numbered list of expense entries. Decide which candidate category each entry belongs to.

### Candidate Categories
${candidateSection}

Use category_index 0 when an entry does not clearly belong to any candidate. Prefer 0 over a guess.

### Output Format

Return a single JSON object:

\`\`\`json
{
  "decisions": [
    { "entry_index": 1, "category_index": 2 }
  ]
}
\`\`\`

### Rules
- \`entry_index\` is the 1-based position of the expense entry in the numbered list you receive. \`category_index\` is the 1-based position of the candidate category.
- Judge every entry you are given exactly once. Do not invent entries and do not repeat an \`entry_index\`.
- \`current_category\` is context only. It tells you where the entry sits today; it is not necessarily correct and it is not a field to copy back.
- Decide from the item name, the notes, and the amount. If the evidence is thin or ambiguous, answer 0 for that entry — leaving an entry alone is always better than filing it wrongly.
${customSection}`;
}

/** The user message: the numbered entries this slice asks about. */
export function buildReclassificationSubjectsMessage(input: {
  subjects: readonly ReclassificationSubject[];
}): string {
  return `### Expense Entries
${input.subjects.map(subjectLine).join("\n")}`;
}

/**
 * Turn the model's answer into the assignments to apply. Anything the model
 * got loose about — an index out of range, a repeated entry, a missing entry,
 * or an explicit 0 — is left exactly as it was. Guessing here would silently
 * mis-file someone's history.
 *
 * A decision that lands on the entry's current category is counted as
 * confirmed rather than emitted, so every emitted decision is a real change
 * and `appliedCount` keeps meaning "this actually moved".
 */
export function resolveReclassificationDecisions(input: {
  subjects: readonly ReclassificationSubject[];
  candidates: readonly ReclassificationCandidate[];
  response: ReclassificationResponse;
}): ResolvedReclassification {
  const decisions: ResolvedReclassification["decisions"] = [];
  const claimed = new Set<number>();
  let confirmedCount = 0;

  for (const decision of input.response.decisions) {
    const entryIndex = decision.entry_index;
    const categoryIndex = decision.category_index;
    if (entryIndex > input.subjects.length || claimed.has(entryIndex)) continue;
    claimed.add(entryIndex);
    if (categoryIndex === 0 || categoryIndex > input.candidates.length) continue;

    const subject = input.subjects[entryIndex - 1];
    const candidate = input.candidates[categoryIndex - 1];
    if (subject == null || candidate == null) continue;
    if (candidate.id === subject.currentCategoryId) {
      confirmedCount += 1;
      continue;
    }
    decisions.push({ ledgerEntryId: subject.ledgerEntryId, categoryId: candidate.id });
  }

  return { decisions, confirmedCount };
}
