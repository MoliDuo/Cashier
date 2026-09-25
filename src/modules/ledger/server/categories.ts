import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getCategoryPreset } from "@/config/category-presets";
import type {
  ApplyCategoryPresetInput,
  ApplyCategoryPresetResult,
  EntryCategoryDto,
  EntryCategoryWithCountDto,
  SaveEntryCategoriesInput,
} from "@/modules/ledger/contracts";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import {
  categoryReclassificationJobs,
  entryCategories,
  ledgerEntries,
  sourceDocuments,
} from "@/persistence";
import {
  lockLedgerForUpdate,
  lockSourceDocumentsForUpdate,
  type PostgresTransaction,
} from "@/lib/db/transaction-locks";
import { assertSourceDocumentNotProcessing } from "@/modules/source-document/server/write-guards";
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
    deletedAt: null,
  };
}

async function assertCategoryCandidatesMutable(
  tx: PostgresTransaction,
  ledgerId: string,
  categoryIds: readonly string[]
): Promise<void> {
  if (categoryIds.length === 0) return;
  const active = await tx
    .select({ id: categoryReclassificationJobs.id })
    .from(categoryReclassificationJobs)
    .where(
      and(
        eq(categoryReclassificationJobs.ledgerId, ledgerId),
        inArray(categoryReclassificationJobs.status, ["preparing", "pending", "running"]),
        sql`(
          EXISTS (
            SELECT 1
            FROM unnest(${categoryReclassificationJobs.candidateCategoryIds}) AS candidate(category_id)
            WHERE ${inArray(sql`candidate.category_id`, categoryIds)}
          )
          OR ${inArray(categoryReclassificationJobs.directCategoryId, categoryIds)}
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
    .where(and(eq(entryCategories.ledgerId, ledgerId), isNull(entryCategories.deletedAt)))
    .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
  return rows.map(mapCategory);
}

export async function getCategory(
  ledgerId: string,
  categoryId: string
): Promise<EntryCategoryDto | null> {
  const row = await db.query.entryCategories.findFirst({
    where: and(
      eq(entryCategories.ledgerId, ledgerId),
      eq(entryCategories.id, categoryId),
      isNull(entryCategories.deletedAt)
    ),
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
      and(
        eq(ledgerEntries.ledgerId, ledgerId),
        eq(ledgerEntries.categoryId, entryCategories.id),
        isNull(ledgerEntries.deletedAt)
      )
    )
    .leftJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        eq(sourceDocuments.ledgerId, ledgerId),
        eq(sourceDocuments.activeRevisionId, ledgerEntries.sourceDocumentRevisionId),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .where(and(eq(entryCategories.ledgerId, ledgerId), isNull(entryCategories.deletedAt)))
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
      .where(
        and(
          eq(entryCategories.id, categoryId),
          eq(entryCategories.ledgerId, ledgerId),
          isNull(entryCategories.deletedAt)
        )
      )
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
      .where(
        and(
          eq(entryCategories.id, categoryId),
          eq(entryCategories.ledgerId, ledgerId),
          isNull(entryCategories.deletedAt)
        )
      );
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
      .where(and(eq(entryCategories.ledgerId, ledgerId), isNull(entryCategories.deletedAt)))
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
            eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
            eq(sourceDocuments.activeRevisionId, ledgerEntries.sourceDocumentRevisionId),
            isNull(sourceDocuments.deletedAt)
          )
        )
        .where(
          and(
            eq(ledgerEntries.ledgerId, ledgerId),
            inArray(ledgerEntries.categoryId, removedIds),
            isNull(ledgerEntries.deletedAt)
          )
        )
        .then((rows) => rows.map((row) => row.id).sort());
      const documents = await lockSourceDocumentsForUpdate(tx, ledgerId, affectedDocumentIds);
      for (const document of documents) await assertSourceDocumentNotProcessing(tx, document);
      await tx
        .update(ledgerEntries)
        .set({ categoryId: null, updatedAt: now })
        .where(
          and(
            eq(ledgerEntries.ledgerId, ledgerId),
            inArray(ledgerEntries.categoryId, removedIds),
            isNull(ledgerEntries.deletedAt)
          )
        );
      await tx
        .update(entryCategories)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(entryCategories.ledgerId, ledgerId),
            inArray(entryCategories.id, removedIds),
            isNull(entryCategories.deletedAt)
          )
        );
    }

    const renamedExisting = targets.filter((target) => {
      const existing = currentById.get(target.id ?? target.clientId!);
      return existing != null && existing.name !== target.name;
    });
    if (renamedExisting.length > 0) {
      const temporaryNames = JSON.stringify(
        renamedExisting.map((target) => ({
          id: target.id ?? target.clientId!,
          name: `__cashier_internal_category_rename__:${crypto.randomUUID()}:${"x".repeat(80)}`,
        }))
      );
      const renamed = await tx.execute(sql`
        WITH renames AS (
          SELECT * FROM jsonb_to_recordset(${temporaryNames}::jsonb) AS value(
            id uuid,
            name text
          )
        )
        UPDATE entry_categories AS category
        SET name = renames.name,
            updated_at = ${now}
        FROM renames
        WHERE category.id = renames.id
          AND category.ledger_id = ${ledgerId}
          AND category.deleted_at IS NULL
        RETURNING category.id
      `);
      if (renamed.rows.length !== renamedExisting.length) {
        throw new ConflictError("Category collection changed during rename");
      }
    }

    const existingTargets = targets.filter((target) =>
      currentById.has(target.id ?? target.clientId!)
    );
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
          AND category.deleted_at IS NULL
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
      .where(
        and(
          eq(entryCategories.ledgerId, ledgerId),
          inArray(entryCategories.id, savedIds),
          isNull(entryCategories.deletedAt)
        )
      )
      .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
    if (saved.length !== savedIds.length) {
      throw new ConflictError("Category save changed during update");
    }
    return saved.map(mapCategory);
  });
}

/**
 * Replace the ledger's category structure with a preset in one transaction,
 * moving entries onto their mapped target instead of unsetting them. Every
 * active category must appear exactly once in `mappings`; `toPresetIndex:
 * null` keeps that category alongside the preset. The result is re-read with
 * counts, so the cached category list keeps showing per-category totals.
 */
export async function applyCategoryPreset(
  ledgerId: string,
  input: ApplyCategoryPresetInput
): Promise<ApplyCategoryPresetResult> {
  // The preset's category text is resolved here from its id, so a client
  // cannot introduce category text of its own.
  const presetCategories = getCategoryPreset(input.presetId);
  const { mappings } = input;
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, ledgerId);
    const activeAssignment = await tx
      .select({ id: categoryReclassificationJobs.id })
      .from(categoryReclassificationJobs)
      .where(
        and(
          eq(categoryReclassificationJobs.ledgerId, ledgerId),
          inArray(categoryReclassificationJobs.status, ["preparing", "pending", "running"])
        )
      )
      .limit(1)
      .then((rows) => rows[0]);
    if (activeAssignment != null) throw new ConflictError("CATEGORY_ASSIGNMENT_ACTIVE");
    const current = await tx
      .select()
      .from(entryCategories)
      .where(and(eq(entryCategories.ledgerId, ledgerId), isNull(entryCategories.deletedAt)))
      .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id)
      .for("update");
    const actualRevision = await computeCategoryCollectionRevision(current);
    if (actualRevision !== input.expectedRevision) {
      throw new ConflictError("Category collection changed since it was loaded");
    }

    // Every active category has to be accounted for exactly once, so the
    // caller can never drop one by omission.
    if (mappings.length !== current.length) {
      throw new ValidationError("Category preset mapping must cover every active category");
    }
    const currentById = new Map(current.map((category) => [category.id, category]));
    const mappedIds = new Set<string>();
    for (const mapping of mappings) {
      if (!currentById.has(mapping.fromCategoryId) || mappedIds.has(mapping.fromCategoryId)) {
        throw new ValidationError("Category preset mapping references an inaccessible category");
      }
      if (
        mapping.toPresetIndex != null &&
        (mapping.toPresetIndex < 0 || mapping.toPresetIndex >= presetCategories.length)
      ) {
        throw new ValidationError("Category preset mapping target is out of range");
      }
      mappedIds.add(mapping.fromCategoryId);
    }

    const now = new Date();

    // Soft-delete what migrates away before inserting anything. The rows stay
    // (only `deleted_at` is set) so the composite foreign key from
    // ledger_entries keeps holding and step 3 can still match `from_id`.
    const reusableTargetByIndex = new Map<number, string>();
    for (const mapping of mappings) {
      const category = currentById.get(mapping.fromCategoryId)!;
      const sameNameIndex = presetCategories.findIndex((preset) => preset.name === category.name);
      if (
        sameNameIndex >= 0 &&
        (mapping.toPresetIndex === sameNameIndex || mapping.toPresetIndex === null)
      ) {
        reusableTargetByIndex.set(sameNameIndex, category.id);
      }
    }
    const migrating = mappings.filter(
      (mapping): mapping is { fromCategoryId: string; toPresetIndex: number } =>
        mapping.toPresetIndex != null &&
        reusableTargetByIndex.get(mapping.toPresetIndex) !== mapping.fromCategoryId
    );
    const migratedIds = migrating.map((mapping) => mapping.fromCategoryId);
    const affectedDocumentIds =
      migrating.length === 0
        ? []
        : await tx
            .selectDistinct({ id: sourceDocuments.id })
            .from(ledgerEntries)
            .innerJoin(
              sourceDocuments,
              and(
                eq(sourceDocuments.ledgerId, ledgerId),
                eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
                eq(sourceDocuments.activeRevisionId, ledgerEntries.sourceDocumentRevisionId),
                isNull(sourceDocuments.deletedAt)
              )
            )
            .where(
              and(
                eq(ledgerEntries.ledgerId, ledgerId),
                inArray(ledgerEntries.categoryId, migratedIds),
                isNull(ledgerEntries.deletedAt)
              )
            )
            .then((rows) => rows.map((row) => row.id).sort());
    const lockedDocuments = await lockSourceDocumentsForUpdate(tx, ledgerId, affectedDocumentIds);
    for (const document of lockedDocuments) await assertSourceDocumentNotProcessing(tx, document);
    if (migratedIds.length > 0) {
      await tx
        .update(entryCategories)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(entryCategories.ledgerId, ledgerId),
            inArray(entryCategories.id, migratedIds),
            isNull(entryCategories.deletedAt)
          )
        );
    }

    // Materialize the preset. A preset name that matches a kept category
    // reuses that row rather than inserting a duplicate: the partial unique
    // index is `WHERE deleted_at IS NULL`, and the user's own description and
    // icon for that name should survive.
    const keptByName = new Map(
      current
        .filter((category) => !migratedIds.includes(category.id))
        .map((category) => [category.name, category])
    );
    const toInsert: { name: string; description: string; icon: string; sortOrder: number }[] = [];
    presetCategories.forEach((preset, index) => {
      if (reusableTargetByIndex.has(index) || keptByName.has(preset.name)) return;
      toInsert.push({
        name: preset.name,
        description: preset.description,
        icon: preset.icon,
        sortOrder: index,
      });
    });
    const inserted =
      toInsert.length === 0
        ? []
        : await tx
            .insert(entryCategories)
            .values(toInsert.map((category) => ({ ledgerId, ...category, updatedAt: now })))
            .returning({ id: entryCategories.id, name: entryCategories.name });
    const insertedByName = new Map(inserted.map((row) => [row.name, row.id]));

    // One target id per preset slot: either a reused row or a fresh insert.
    const presetTargetIds = presetCategories.map(
      (preset, index) =>
        reusableTargetByIndex.get(index) ??
        keptByName.get(preset.name)?.id ??
        insertedByName.get(preset.name)!
    );

    // Move every migrated category's entries onto its target. Set-based, so
    // many-to-one collapses naturally.
    let movedEntryCount = 0;
    if (migrating.length > 0) {
      const transfers = JSON.stringify(
        migrating.map((mapping) => ({
          from_id: mapping.fromCategoryId,
          to_id: presetTargetIds[mapping.toPresetIndex]!,
        }))
      );
      const moved = await tx.execute<{ source_document_id: string }>(sql`
        WITH transfers AS (
          SELECT * FROM jsonb_to_recordset(${transfers}::jsonb) AS value(
            from_id uuid,
            to_id uuid
          )
        )
        UPDATE ledger_entries AS entry
        SET category_id = transfers.to_id,
            updated_at = ${now}
        FROM transfers, source_documents AS document
        WHERE entry.ledger_id = ${ledgerId}
          AND entry.category_id = transfers.from_id
          AND entry.deleted_at IS NULL
          AND document.ledger_id = ${ledgerId}
          AND document.id = entry.source_document_id
          AND document.active_revision_id = entry.source_document_revision_id
          AND document.deleted_at IS NULL
          AND entry.category_id IS DISTINCT FROM transfers.to_id
        RETURNING entry.source_document_id
      `);
      movedEntryCount = moved.rows.length;
    }

    // Preset categories take the leading slots; kept extras follow. A reused
    // row already occupies its preset slot.
    const orderById = new Map<string, number>();
    presetCategories.forEach((_, index) => orderById.set(presetTargetIds[index]!, index));
    let nextSortOrder = presetCategories.length;
    for (const category of current) {
      if (migratedIds.includes(category.id) || orderById.has(category.id)) continue;
      orderById.set(category.id, nextSortOrder);
      nextSortOrder += 1;
    }
    const ordering = JSON.stringify(
      [...orderById].map(([id, sortOrder]) => ({ id, sort_order: sortOrder }))
    );
    await tx.execute(sql`
      WITH ordering AS (
        SELECT * FROM jsonb_to_recordset(${ordering}::jsonb) AS value(
          id uuid,
          sort_order integer
        )
      )
      UPDATE entry_categories AS category
      SET sort_order = ordering.sort_order,
          updated_at = ${now}
      FROM ordering
      WHERE category.id = ordering.id
        AND category.ledger_id = ${ledgerId}
        AND category.deleted_at IS NULL
        AND category.sort_order IS DISTINCT FROM ordering.sort_order
    `);

    const saved = await tx
      .select({
        category: entryCategories,
        entryCount: sql<number>`count(${sourceDocuments.id})`,
      })
      .from(entryCategories)
      .leftJoin(
        ledgerEntries,
        and(
          eq(ledgerEntries.ledgerId, ledgerId),
          eq(ledgerEntries.categoryId, entryCategories.id),
          isNull(ledgerEntries.deletedAt)
        )
      )
      .leftJoin(
        sourceDocuments,
        and(
          eq(sourceDocuments.ledgerId, ledgerId),
          eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
          eq(sourceDocuments.activeRevisionId, ledgerEntries.sourceDocumentRevisionId),
          isNull(sourceDocuments.deletedAt)
        )
      )
      .where(and(eq(entryCategories.ledgerId, ledgerId), isNull(entryCategories.deletedAt)))
      .groupBy(entryCategories.id)
      .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
    const orderingChanged = [...orderById].some(
      ([id, sortOrder]) => currentById.get(id)?.sortOrder !== sortOrder
    );
    return {
      categories: saved.map(({ category, entryCount }) => ({
        ...mapCategory(category),
        entryCount: Number(entryCount),
      })),
      changed:
        movedEntryCount > 0 || inserted.length > 0 || migratedIds.length > 0 || orderingChanged,
      movedEntryCount,
      createdCategoryCount: inserted.length,
      removedCategoryCount: migratedIds.length,
      retainedCategoryCount: current.filter(
        (category) => !migratedIds.includes(category.id) && !presetTargetIds.includes(category.id)
      ).length,
    };
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
        eq(sourceDocuments.ledgerId, ledgerId),
        eq(sourceDocuments.activeRevisionId, ledgerEntries.sourceDocumentRevisionId),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .where(
      and(
        eq(ledgerEntries.ledgerId, ledgerId),
        isNull(ledgerEntries.categoryId),
        isNull(ledgerEntries.deletedAt)
      )
    )
    .then((rows) => rows[0]);
  return Number(row?.count ?? 0);
}
