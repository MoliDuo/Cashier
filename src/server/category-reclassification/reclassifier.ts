import "server-only";
import { getOpenAIClient } from "@/lib/ai/openai-client";
import { runtimeEnv } from "@/lib/env/runtime";
import { AppError } from "@/lib/errors";
import { extractJson } from "@/lib/tasks/json-utils";
import {
  buildReclassificationDocumentMessage,
  buildReclassificationPrompt,
  reclassificationResponseSchema,
  resolveReclassificationDecisions,
  type ReclassificationCandidate,
  type ReclassificationDocumentGroup,
} from "@/modules/ledger/domain/reclassification-protocol";
import { AI_CATEGORY_REQUEST_TIMEOUT_MS } from "@/config/tuning";

/** One document can be a full receipt: up to MAX_BATCH_SIZE rows, one decision each. */
const MAX_TOKENS = 4000;
/** Batch assignment is a judgement call, not a creative one. */
const TEMPERATURE = 0.1;

/**
 * Places entries into one of a caller-chosen set of categories. A comparison
 * against candidates, not an entry edit: the caller persists the decisions.
 */
export async function decideEntryCategories(input: {
  candidates: readonly ReclassificationCandidate[];
  group: ReclassificationDocumentGroup;
  /** Encoded evidence for this document; empty for a text-only submission. */
  images: readonly { dataUrl: string }[];
  customPrompt?: string;
  signal?: AbortSignal;
}): Promise<{
  decisions: readonly { ledgerEntryId: string; categoryId: string }[];
  confirmedCount: number;
}> {
  const prompt = buildReclassificationPrompt({
    candidates: input.candidates,
    ...(input.customPrompt == null ? {} : { customPrompt: input.customPrompt }),
  });
  const result = await getOpenAIClient().generateContent(
    prompt,
    [
      {
        role: "user",
        content: buildReclassificationDocumentMessage({
          group: input.group,
          images: input.images,
        }),
      },
    ],
    runtimeEnv.aiModel,
    MAX_TOKENS,
    TEMPERATURE,
    input.signal,
    { maxAttempts: 1, timeoutMs: AI_CATEGORY_REQUEST_TIMEOUT_MS }
  );

  try {
    const response = reclassificationResponseSchema.parse(JSON.parse(extractJson(result.content)));
    return resolveReclassificationDecisions({
      subjects: input.group.subjects,
      candidates: input.candidates,
      response,
    });
  } catch (error) {
    throw new AppError(
      "AI category reclassification response was invalid",
      "ai_schema_invalid",
      502,
      {
        cause: error instanceof Error ? error.name : "UnknownError",
      }
    );
  }
}
