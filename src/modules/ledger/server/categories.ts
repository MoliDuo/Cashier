import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  EntryCategoryDto,
  EntryCategoryWithCountDto,
  SaveEntryCategoriesInput,
} from "@/modules/ledger/contracts";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import {
  categoryAssignmentJobs,
  entryCategories,
  ledgerEntries,
  sourceDocuments,
} from "@/persistence";
import {
  lockLedgerForUpdate,
  lockSourceDocumentsForUpdate,
  type PostgresTransaction,
} from "@/lib/db/transaction-locks";
import { assertSourceDocumentsNotProcessing } from "@/modules/source-document/server/write-guards";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";

function mapCategory(row: typeof entryCategories.$inferSelect): EntryCategoryDto {
  return {
    id: row.id,
    ledgerId: row.ledgerId,
    name: row.name,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertCategoryCandidatesMutable(
  tx: PostgresTransaction,
  ledgerId: string,
  categoryIds: readonly string[]
): Promise<void> {
  if (categoryIds.length === 0) return;
  const active = await tx
    .select({ id: categoryAssignmentJobs.id })
    .from(categoryAssignmentJobs)
    .where(
      and(
        eq(categoryAssignmentJobs.ledgerId, ledgerId),
        inArray(categoryAssignmentJobs.status, ["pending", "running"]),
        sql`(
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements(${categoryAssignmentJobs.candidateSnapshot}) AS candidate
            WHERE ${inArray(sql`(candidate->>'id')::uuid`, categoryIds)}
          )
          OR ${inArray(categoryAssignmentJobs.assignCategoryId, categoryIds)}
        )`
      )
    )
    .limit(1)
    .then((rows) => rows[0]);
  if (active != null) throw new ConflictError("CATEGORY_ASSIGNMENT_ACTIVE");
}

export async function listCategories(ledgerId: string): Promise<EntryCategoryDto[]> {
  const rows = await db
    .select()
    .from(entryCategories)
    .where(eq(entryCategories.ledgerId, ledgerId))
    .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
  return rows.map(mapCategory);
}

export async function getCategory(
  ledgerId: string,
  categoryId: string
): Promise<EntryCategoryDto | null> {
  const row = await db.query.entryCategories.findFirst({
    where: and(eq(entryCategories.ledgerId, ledgerId), eq(entryCategories.id, categoryId)),
  });
  return row == null ? null : mapCategory(row);
}

/** The category's name for a record title, or empty when it has none or is gone. */
export async function getCategoryName(
  ledgerId: string,
  categoryId: string | null
): Promise<string> {
  if (categoryId == null || categoryId === "") return "";
  return (await getCategory(ledgerId, categoryId))?.name ?? "";
}

export async function listCategoriesWithCount(
  ledgerId: string
): Promise<EntryCategoryWithCountDto[]> {
  const rows = await db
    .select({
      category: entryCategories,
      entryCount: sql<number>`count(${sourceDocuments.id})`,
    })
    .from(entryCategories)
    .leftJoin(
      ledgerEntries,
      and(eq(ledgerEntries.ledgerId, ledgerId), eq(ledgerEntries.categoryId, entryCategories.id))
    )
    .leftJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        eq(sourceDocuments.ledgerId, ledgerId)
      )
    )
    .where(eq(entryCategories.ledgerId, ledgerId))
    .groupBy(entryCategories.id)
    .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
  return rows.map(({ category, entryCount }) => ({
    ...mapCategory(category),
    entryCount: Number(entryCount),
  }));
}

export async function updateMissingCategoryMetadata(
  ledgerId: string,
  categoryId: string,
  input: { icon: string; description: string; expectedName: string }
): Promise<{
  status: "updated" | "stale" | "not_found";
  wroteIcon: boolean;
  wroteDescription: boolean;
}> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, ledgerId);
    const category = await tx
      .select({
        name: entryCategories.name,
        icon: entryCategories.icon,
        description: entryCategories.description,
      })
      .from(entryCategories)
      .where(and(eq(entryCategories.id, categoryId), eq(entryCategories.ledgerId, ledgerId)))
      .for("update")
      .then((rows) => rows[0]);
    if (category == null) {
      return { status: "not_found" as const, wroteIcon: false, wroteDescription: false };
    }
    if (category.name !== input.expectedName) {
      return { status: "stale" as const, wroteIcon: false, wroteDescription: false };
    }
    const wroteIcon = category.icon == null || category.icon === "";
    const wroteDescription = category.description == null || category.description === "";
    if (!wroteIcon && !wroteDescription) {
      return { status: "updated" as const, wroteIcon: false, wroteDescription: false };
    }
    if (wroteDescription) await assertCategoryCandidatesMutable(tx, ledgerId, [categoryId]);
    await tx
      .update(entryCategories)
      .set({
        ...(wroteIcon ? { icon: input.icon } : {}),
        ...(wroteDescription ? { description: input.description } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(entryCategories.id, categoryId), eq(entryCategories.ledgerId, ledgerId)));
    return { status: "updated" as const, wroteIcon, wroteDescription };
  });
}

export async function saveEntryCategories(
  ledgerId: string,
  input: SaveEntryCategoriesInput
): Promise<EntryCategoryDto[]> {
  const { expectedRevision } = input;
  const targets = input.categories.map((category, sortOrder) => ({ ...category, sortOrder }));
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, ledgerId);
    const current = await tx
      .select()
      .from(entryCategories)
      .where(eq(entryCategories.ledgerId, ledgerId))
      .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id)
      .for("update");
    const actualRevision = await computeCategoryCollectionRevision(current);
    if (actualRevision !== expectedRevision) {
      throw new ConflictError("Category collection changed since it was loaded");
    }
    const currentById = new Map(current.map((category) => [category.id, category]));
    const targetIds = new Set(targets.map((target) => target.id ?? target.clientId!));

    for (const target of targets) {
      const resolvedId = target.id ?? target.clientId!;
      const existing = currentById.get(resolvedId);
      if (target.id != null && existing == null) {
        throw new ValidationError("Category target contains an inaccessible category");
      }
    }

    const removed = current.filter((category) => !targetIds.has(category.id));
    const candidateAffectingIds = [
      ...removed.map((category) => category.id),
      ...targets.flatMap((target) => {
        const existing = target.id == null ? undefined : currentById.get(target.id);
        return existing != null &&
          (existing.name !== target.name || existing.description !== target.description)
          ? [existing.id]
          : [];
      }),
    ];
    await assertCategoryCandidatesMutable(tx, ledgerId, candidateAffectingIds);

    const now = new Date();
    const removedIds = removed.map((category) => category.id);
    if (removedIds.length > 0) {
      const affectedDocumentIds = await tx
        .selectDistinct({ id: sourceDocuments.id })
        .from(ledgerEntries)
        .innerJoin(
          sourceDocuments,
          and(
            eq(sourceDocuments.ledgerId, ledgerId),
            eq(sourceDocuments.id, ledgerEntries.sourceDocumentId)
          )
        )
        .where(
          and(eq(ledgerEntries.ledgerId, ledgerId), inArray(ledgerEntries.categoryId, removedIds))
        )
        .then((rows) => rows.map((row) => row.id).sort());
      const documents = await lockSourceDocumentsForUpdate(tx, ledgerId, affectedDocumentIds);
      await assertSourceDocumentsNotProcessing(tx, documents);
      await tx
        .update(ledgerEntries)
        .set({ categoryId: null, updatedAt: now })
        .where(
          and(eq(ledgerEntries.ledgerId, ledgerId), inArray(ledgerEntries.categoryId, removedIds))
        );
      await tx
        .delete(entryCategories)
        .where(
          and(eq(entryCategories.ledgerId, ledgerId), inArray(entryCategories.id, removedIds))
        );
    }

    const existingTargets = targets.filter((target) =>
      currentById.has(target.id ?? target.clientId!)
    );
    // One statement renames them all. Names are unique per ledger through a
    // deferrable constraint, checked when the statement ends rather than row by
    // row, so a save may swap or rotate names among its categories.
    if (existingTargets.length > 0) {
      const updates = JSON.stringify(
        existingTargets.map((target) => ({
          id: target.id ?? target.clientId!,
          name: target.name,
          description: target.description,
          icon: target.icon,
          sort_order: target.sortOrder,
        }))
      );
      const updated = await tx.execute(sql`
        WITH changes AS (
          SELECT * FROM jsonb_to_recordset(${updates}::jsonb) AS value(
            id uuid,
            name text,
            description text,
            icon text,
            sort_order integer
          )
        )
        UPDATE entry_categories AS category
        SET name = changes.name,
            description = changes.description,
            icon = changes.icon,
            sort_order = changes.sort_order,
            updated_at = ${now}
        FROM changes
        WHERE category.id = changes.id
          AND category.ledger_id = ${ledgerId}
        RETURNING category.id
      `);
      if (updated.rows.length !== existingTargets.length) {
        throw new ConflictError("Category collection changed during update");
      }
    }

    const newTargets = targets.filter((target) => !currentById.has(target.id ?? target.clientId!));
    if (newTargets.length > 0) {
      await tx.insert(entryCategories).values(
        newTargets.map((target) => ({
          id: target.id ?? target.clientId!,
          ledgerId,
          name: target.name,
          description: target.description,
          icon: target.icon,
          sortOrder: target.sortOrder,
          updatedAt: now,
        }))
      );
    }

    const savedIds = targets.map((target) => target.id ?? target.clientId!);
    if (savedIds.length === 0) return [];
    const saved = await tx
      .select()
      .from(entryCategories)
      .where(and(eq(entryCategories.ledgerId, ledgerId), inArray(entryCategories.id, savedIds)))
      .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
    if (saved.length !== savedIds.length) {
      throw new ConflictError("Category save changed during update");
    }
    return saved.map(mapCategory);
  });
}

export async function countUncategorizedEntries(ledgerId: string): Promise<number> {
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(ledgerEntries)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        eq(sourceDocuments.ledgerId, ledgerId)
      )
    )
    .where(and(eq(ledgerEntries.ledgerId, ledgerId), isNull(ledgerEntries.categoryId)))
    .then((rows) => rows[0]);
  return Number(row?.count ?? 0);
}
