import type { CategoryPort } from "@/application/contracts";
import { getCategoryPreset } from "@/config/category-presets";
import type {
  ApplyCategoryPresetInput,
  ApplyCategoryPresetResult,
} from "@/modules/ledger/contracts";

/**
 * Resolve the preset's category text on the server and hand the switch to the
 * port. The client sends only which preset and where each existing category's
 * entries land, so it cannot introduce category text of its own.
 *
 * The result is re-read with counts so the cached category list keeps showing
 * per-category totals: a switch renames and merges categories, and the caller
 * would otherwise be left holding counts that belong to the previous set.
 */
export async function applyCategoryPreset(
  ledgerId: string,
  input: ApplyCategoryPresetInput,
  categories: Pick<CategoryPort, "applyPreset" | "listWithCount">
): Promise<ApplyCategoryPresetResult> {
  const result = await categories.applyPreset(ledgerId, {
    expectedRevision: input.expectedRevision,
    presetCategories: getCategoryPreset(input.presetId, input.locale),
    mappings: input.mappings,
  });
  return {
    ...result,
    categories: result.categories.map((category) => ({ ...category, deletedAt: null })),
  };
}
