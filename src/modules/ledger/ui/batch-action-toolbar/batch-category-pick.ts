/**
 * What a pick in the batch category dialog asks for.
 *
 * One category is the user's own answer, so it is applied directly. More than
 * one is a question only the model can answer — which of these belongs where —
 * so the same control asks it instead. Clearing is a pick of its own, because
 * "no category" is a decision, not the absence of one.
 *
 * The dialog and the band both read this, so the summary under the list and the
 * write its button starts can never disagree.
 */

/** One pick is the user's own answer; two is the fewest the model can choose
 * between; more than eight dilutes the decision and the prompt. */
export const MAX_RECLASSIFICATION_CANDIDATES = 8;

export type BatchCategoryPick =
  | { kind: "none" }
  | { kind: "clear" }
  | { kind: "assign"; categoryId: string }
  | { kind: "ai"; categoryIds: readonly string[] }
  | { kind: "tooMany" };

export function resolveBatchCategoryPick({
  categoryIds,
  clearPicked,
}: {
  categoryIds: readonly string[];
  clearPicked: boolean;
}): BatchCategoryPick {
  if (clearPicked) return { kind: "clear" };

  const [first, ...rest] = categoryIds;
  if (first == null) return { kind: "none" };
  if (rest.length === 0) return { kind: "assign", categoryId: first };
  if (rest.length + 1 > MAX_RECLASSIFICATION_CANDIDATES) return { kind: "tooMany" };
  return { kind: "ai", categoryIds };
}

/** Whether confirming would write anything. */
export function isConfirmableBatchCategoryPick(pick: BatchCategoryPick): boolean {
  return pick.kind === "clear" || pick.kind === "assign" || pick.kind === "ai";
}
