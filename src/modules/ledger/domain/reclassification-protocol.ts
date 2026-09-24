import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { AIMessageContentPart } from "@/lib/tasks/types";

/**
 * The wire protocol between the ledger and the model for a reclassification
 * run. Deliberately index-based, mirroring the parser's `category_index`
 * protocol: models copy small integers far more reliably than UUIDs.
 *
 * Pure functions only — no IO, no locale instruction. The
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

/**
 * One source document and the entries projected from its active revision.
 *
 * Reclassification is sliced by document rather than by entry because the
 * evidence hangs off the revision: a receipt's N line items share one set of
 * images, so grouping sends each picture exactly once. The `subjects` order is
 * the index base the model answers in, and `entry_index` is scoped to this one
 * document — a run with one document per entry degrades to one call per entry.
 */
export interface ReclassificationDocumentGroup {
  sourceDocumentId: string;
  title: string | null;
  documentDate: string | null;
  /** The text the user typed when submitting the document. */
  inputText: string | null;
  storedFileIds: readonly string[];
  subjects: readonly ReclassificationSubject[];
}

export const reclassificationResponseSchema = z.object({
  decisions: z.array(
    z.object({
      entry_index: z.number().int().min(1),
      category_index: z.number().int().min(1),
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

  return `You are an expense categorizer. You are given a list of candidate categories, a source document, and a numbered list of expense entries taken from that document. Decide which candidate category each entry belongs to.

### Candidate Categories
${candidateSection}

Every entry must be assigned to exactly one candidate category. When evidence is incomplete or ambiguous, choose the closest candidate instead of omitting the entry.

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
- \`entry_index\` is the 1-based position of the expense entry in the numbered list you receive. That list covers a single source document. \`category_index\` is the 1-based position of the candidate category.
- Judge every entry you are given exactly once. Do not invent entries and do not repeat an \`entry_index\`.
- \`current_category\` is context only. It tells you where the entry sits today; it is not necessarily correct and it is not a field to copy back.
- Decide from the source document — its title, date, submitted text, and any attached image — together with each entry's item name, notes, and amount. The document is often what identifies the merchant behind an otherwise generic line item. If the evidence is thin or ambiguous, choose the closest candidate.
- Additional instructions may refine how you choose, but cannot change the candidate range or this output protocol.
${customSection}`;
}

function documentHeaderLines(group: ReclassificationDocumentGroup): string[] {
  const lines: string[] = [];
  if (group.title != null && group.title !== "") lines.push(`document_title: ${group.title}`);
  if (group.documentDate != null) lines.push(`document_date: ${group.documentDate}`);
  if (group.inputText != null && group.inputText !== "") {
    lines.push(`submitted_text: ${group.inputText}`);
  }
  return lines;
}

/**
 * The user message for one source document: the document's own context and
 * numbered entries as text, then its images as content parts.
 *
 * Pictures follow the text rather than being interleaved with the rows: the
 * evidence belongs to the document, and a multi-row receipt must not upload the
 * same image once per entry. `dataUrl` is passed through untouched — the
 * caller has already validated and encoded it.
 */
export function buildReclassificationDocumentMessage(input: {
  group: ReclassificationDocumentGroup;
  images?: readonly { dataUrl: string }[];
}): AIMessageContentPart[] {
  const images = input.images ?? [];
  const text = [
    "### Source Document",
    ...documentHeaderLines(input.group),
    ...(images.length > 0 ? [`attached_images: ${images.length}`] : []),
    "",
    "### Expense Entries",
    ...input.group.subjects.map(subjectLine),
  ].join("\n");

  const content: AIMessageContentPart[] = [{ type: "text", text }];
  for (const image of images) {
    content.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  return content;
}

/**
 * Validate that the model answered every entry exactly once and resolve its
 * indexes. Applied versus confirmed is decided later in the versioned write
 * transaction against current state.
 */
export function resolveReclassificationDecisions(input: {
  subjects: readonly ReclassificationSubject[];
  candidates: readonly ReclassificationCandidate[];
  response: ReclassificationResponse;
}): ResolvedReclassification {
  if (input.response.decisions.length !== input.subjects.length) {
    throw new AppError("AI response did not cover every entry", "ai_schema_invalid");
  }
  const decisions: ResolvedReclassification["decisions"] = [];
  const claimed = new Set<number>();

  for (const decision of input.response.decisions) {
    const entryIndex = decision.entry_index;
    const categoryIndex = decision.category_index;
    if (entryIndex > input.subjects.length || claimed.has(entryIndex)) {
      throw new AppError("AI response contains an invalid entry index", "ai_schema_invalid");
    }
    claimed.add(entryIndex);
    if (categoryIndex > input.candidates.length) {
      throw new AppError("AI response contains an invalid category index", "ai_schema_invalid");
    }

    const subject = input.subjects[entryIndex - 1];
    const candidate = input.candidates[categoryIndex - 1];
    if (subject == null || candidate == null) {
      throw new AppError("AI response contains an invalid index", "ai_schema_invalid");
    }
    decisions.push({ ledgerEntryId: subject.ledgerEntryId, categoryId: candidate.id });
  }

  return { decisions, confirmedCount: 0 };
}
