"use server";
import { withLedgerAccess } from "../access";
import type { EntryCategoryDto } from "@/modules/ledger/contracts";
import {
  parseSaveEntryCategoriesInput,
  type SaveEntryCategoriesInput,
} from "@/modules/ledger/contract-schemas";
import { saveEntryCategories } from "../server/categories";

export const saveEntryCategoriesAction = withLedgerAccess(
  async (ledgerId: string, input: SaveEntryCategoriesInput): Promise<EntryCategoryDto[]> => {
    const validated = parseSaveEntryCategoriesInput(input);
    return saveEntryCategories(ledgerId, {
      expectedRevision: validated.expectedRevision,
      categories: validated.categories.map((category) => ({
        ...(category.id === undefined ? {} : { id: category.id }),
        ...(category.clientId === undefined ? {} : { clientId: category.clientId }),
        name: category.name,
        description: category.description,
        icon: category.icon,
      })),
    });
  }
);
