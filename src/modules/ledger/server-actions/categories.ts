"use server";
import { withLedgerAccess } from "../access";
import type { ApplyCategoryPresetInput, EntryCategoryDto } from "@/modules/ledger/contracts";
import {
  parseApplyCategoryPresetInput,
  parseSaveEntryCategoriesInput,
  type SaveEntryCategoriesInput,
} from "@/modules/ledger/contract-schemas";
import { applyCategoryPreset } from "@/modules/ledger/application/use-cases/apply-category-preset";
import { serverComposition } from "@/application/server-composition-root";
import { saveEntryCategories } from "@/modules/ledger/application/use-cases/save-entry-categories";

export const saveEntryCategoriesAction = withLedgerAccess(
  async (ledgerId: string, input: SaveEntryCategoriesInput): Promise<EntryCategoryDto[]> => {
    const validated = parseSaveEntryCategoriesInput(input);
    return saveEntryCategories(
      ledgerId,
      {
        expectedRevision: validated.expectedRevision,
        categories: validated.categories.map((category) => ({
          ...(category.id === undefined ? {} : { id: category.id }),
          ...(category.clientId === undefined ? {} : { clientId: category.clientId }),
          name: category.name,
          description: category.description,
          icon: category.icon,
        })),
      },
      serverComposition.categories
    );
  }
);

export const applyCategoryPresetAction = withLedgerAccess(
  async (
    ledgerId: string,
    input: ApplyCategoryPresetInput
  ): Promise<import("@/modules/ledger/contracts").ApplyCategoryPresetResult> => {
    const validated = parseApplyCategoryPresetInput(input);
    return applyCategoryPreset(
      ledgerId,
      {
        expectedRevision: validated.expectedRevision,
        presetId: validated.presetId,
        mappings: validated.mappings,
      },
      serverComposition.categories
    );
  }
);
