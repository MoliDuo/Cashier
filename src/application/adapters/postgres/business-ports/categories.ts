import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { CategoryPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { entryCategories, ledgerEntries, sourceDocuments } from "@/persistence";
import { lockLedgerForUpdate } from "../transaction-locks";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";

import { mapCategory } from "./shared";

export const postgresCategoryAdapter: CategoryPort = {
  async list(ledgerId) {
    const rows = await db
      .select()
      .from(entryCategories)
      .where(and(eq(entryCategories.ledgerId, ledgerId), isNull(entryCategories.deletedAt)))
      .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
    return rows.map(mapCategory);
  },

  async get(ledgerId, categoryId) {
    const row = await db.query.entryCategories.findFirst({
      where: and(
        eq(entryCategories.ledgerId, ledgerId),
        eq(entryCategories.id, categoryId),
        isNull(entryCategories.deletedAt)
      ),
    });
    return row == null ? null : mapCategory(row);
  },

  async listWithCount(ledgerId) {
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
  },

  async create(ledgerId, input) {
    return db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, ledgerId);
      const [last] = await tx
        .select({ sortOrder: entryCategories.sortOrder })
        .from(entryCategories)
        .where(and(eq(entryCategories.ledgerId, ledgerId), isNull(entryCategories.deletedAt)))
        .orderBy(desc(entryCategories.sortOrder))
        .limit(1);
      const created = await tx
        .insert(entryCategories)
        .values({ ...input, ledgerId, sortOrder: input.sortOrder ?? (last?.sortOrder ?? -1) + 1 })
        .returning()
        .then((rows) => rows[0]);
      if (created == null) throw new ConflictError("Failed to create category");
      return mapCategory(created);
    });
  },

  async update(ledgerId, categoryId, input) {
    const updated = await db
      .update(entryCategories)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(entryCategories.ledgerId, ledgerId),
          eq(entryCategories.id, categoryId),
          isNull(entryCategories.deletedAt)
        )
      )
      .returning()
      .then((rows) => rows[0]);
    return updated == null ? null : mapCategory(updated);
  },

  async updateMissingMetadata(ledgerId, categoryId, input) {
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
  },

  async delete(ledgerId, categoryId) {
    return db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, ledgerId);
      const category = await tx
        .select({ id: entryCategories.id })
        .from(entryCategories)
        .where(
          and(
            eq(entryCategories.ledgerId, ledgerId),
            eq(entryCategories.id, categoryId),
            isNull(entryCategories.deletedAt)
          )
        )
        .then((rows) => rows[0]);
      if (category == null) return false;
      const now = new Date();
      await tx
        .update(ledgerEntries)
        .set({ categoryId: null, updatedAt: now })
        .where(
          and(
            eq(ledgerEntries.ledgerId, ledgerId),
            eq(ledgerEntries.categoryId, categoryId),
            isNull(ledgerEntries.deletedAt)
          )
        );
      await tx
        .update(entryCategories)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(entryCategories.ledgerId, ledgerId), eq(entryCategories.id, categoryId)));
      return true;
    });
  },

  async reorder(ledgerId, categoryIds) {
    return db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, ledgerId);
      if (categoryIds.length === 0) return 0;
      const active = await tx
        .select({ id: entryCategories.id })
        .from(entryCategories)
        .where(and(eq(entryCategories.ledgerId, ledgerId), isNull(entryCategories.deletedAt)))
        .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
      const activeIds = new Set(active.map((category) => category.id));
      if (
        categoryIds.length !== active.length ||
        new Set(categoryIds).size !== categoryIds.length ||
        categoryIds.some((categoryId) => !activeIds.has(categoryId))
      ) {
        throw new ValidationError("Category reorder must include every active category");
      }
      const ordering = JSON.stringify(
        categoryIds.map((id, sortOrder) => ({ id, sort_order: sortOrder }))
      );
      const updated = await tx.execute(sql`
        WITH positions AS (
          SELECT * FROM jsonb_to_recordset(${ordering}::jsonb) AS value(
            id uuid,
            sort_order integer
          )
        )
        UPDATE entry_categories AS category
        SET sort_order = positions.sort_order,
            updated_at = ${new Date()}
        FROM positions
        WHERE category.id = positions.id
          AND category.ledger_id = ${ledgerId}
          AND category.deleted_at IS NULL
        RETURNING category.id
      `);
      if (updated.rows.length !== categoryIds.length) {
        throw new ConflictError("Category reorder changed during update");
      }
      return categoryIds.length;
    });
  },

  async saveAll(ledgerId, targets, expectedRevision) {
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

      const now = new Date();
      const removedIds = removed.map((category) => category.id);
      if (removedIds.length > 0) {
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

      const newTargets = targets.filter(
        (target) => !currentById.has(target.id ?? target.clientId!)
      );
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
  },

  async applyPreset(ledgerId, input) {
    const { presetCategories, mappings } = input;
    return db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, ledgerId);
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
      const migrating = mappings.filter(
        (mapping): mapping is { fromCategoryId: string; toPresetIndex: number } =>
          mapping.toPresetIndex != null
      );
      const migratedIds = migrating.map((mapping) => mapping.fromCategoryId);
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
        if (keptByName.has(preset.name)) return;
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
        (preset) => keptByName.get(preset.name)?.id ?? insertedByName.get(preset.name)!
      );

      // Move every migrated category's entries onto its target. Set-based, so
      // many-to-one collapses naturally.
      if (migrating.length > 0) {
        const transfers = JSON.stringify(
          migrating.map((mapping) => ({
            from_id: mapping.fromCategoryId,
            to_id: presetTargetIds[mapping.toPresetIndex]!,
          }))
        );
        await tx.execute(sql`
          WITH transfers AS (
            SELECT * FROM jsonb_to_recordset(${transfers}::jsonb) AS value(
              from_id uuid,
              to_id uuid
            )
          )
          UPDATE ledger_entries AS entry
          SET category_id = transfers.to_id,
              updated_at = ${now}
          FROM transfers
          WHERE entry.ledger_id = ${ledgerId}
            AND entry.category_id = transfers.from_id
            AND entry.deleted_at IS NULL
        `);
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
      `);

      const saved = await tx
        .select()
        .from(entryCategories)
        .where(and(eq(entryCategories.ledgerId, ledgerId), isNull(entryCategories.deletedAt)))
        .orderBy(entryCategories.sortOrder, entryCategories.createdAt, entryCategories.id);
      return saved.map(mapCategory);
    });
  },

  async countUncategorized(ledgerId) {
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
  },
};
