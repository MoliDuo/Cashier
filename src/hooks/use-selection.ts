"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MAX_BATCH_SIZE } from "@/lib/batch-ids";

interface UseSelectionOptions {
  allIds: string[];
  queryFingerprint?: string | null;
  /** `null` allows every currently loaded item to be selected. */
  maxSelected?: number | null;
}

interface UseSelectionReturn {
  selectedIds: string[];
  isSelectionMode: boolean;
  isAllSelected: boolean;
  isSelectionLimitReached: boolean;
  selectableCount: number;
  selectedCount: number;
  handleSelect: (id: string, selected: boolean) => void;
  handleSelectAll: (selected: boolean) => void;
  /** Adds or removes a subset — a day's rows — in one update. */
  handleSelectMany: (ids: readonly string[], selected: boolean) => void;
  toggleSelectionMode: () => void;
  clearSelection: () => void;
  exitSelectionMode: () => void;
  setSelectionMode: (value: boolean) => void;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  retainSelection: (ids: string[]) => void;
}

interface SelectionState {
  queryFingerprint: string | null | undefined;
  selectedIds: string[];
  isSelectionMode: boolean;
}

function limitSelection(ids: string[], maxSelected: number | null): string[] {
  return maxSelected == null ? ids : ids.slice(0, maxSelected);
}

function intersectSelection(
  selectedIds: string[],
  visibleIds: ReadonlySet<string>,
  maxSelected: number | null
): string[] {
  return limitSelection(
    selectedIds.filter((id) => visibleIds.has(id)),
    maxSelected
  );
}

export function useSelection({
  allIds,
  queryFingerprint,
  maxSelected = MAX_BATCH_SIZE,
}: UseSelectionOptions): UseSelectionReturn {
  const [selection, setSelection] = useState<SelectionState>(() => ({
    queryFingerprint,
    selectedIds: [],
    isSelectionMode: false,
  }));
  const uniqueAllIds = useMemo(() => [...new Set(allIds)], [allIds]);
  const uniqueAllIdSet = useMemo(() => new Set(uniqueAllIds), [uniqueAllIds]);
  const selectableCount =
    maxSelected == null ? uniqueAllIds.length : Math.min(uniqueAllIds.length, maxSelected);

  const storedSelectedIds =
    selection.queryFingerprint === queryFingerprint ? selection.selectedIds : [];
  const selectedIds = intersectSelection(storedSelectedIds, uniqueAllIdSet, maxSelected);
  const isSelectionMode =
    selection.queryFingerprint === queryFingerprint ? selection.isSelectionMode : false;
  const selectedCount = selectedIds.length;
  const isAllSelected = selectedCount === selectableCount && selectableCount > 0;
  const isSelectionLimitReached = maxSelected != null && selectedCount >= maxSelected;

  const handleSelect = useCallback(
    (id: string, selected: boolean) => {
      setSelection((current) => {
        const selectedIds = intersectSelection(
          current.queryFingerprint === queryFingerprint ? current.selectedIds : [],
          uniqueAllIdSet,
          maxSelected
        );
        const nextIds = selected
          ? selectedIds.includes(id)
            ? selectedIds
            : (maxSelected != null && selectedIds.length >= maxSelected) || !uniqueAllIdSet.has(id)
              ? selectedIds
              : [...selectedIds, id]
          : selectedIds.includes(id)
            ? selectedIds.filter((itemId) => itemId !== id)
            : selectedIds;
        return {
          queryFingerprint,
          selectedIds: nextIds,
          isSelectionMode: current.queryFingerprint === queryFingerprint && current.isSelectionMode,
        };
      });
    },
    [maxSelected, queryFingerprint, uniqueAllIdSet]
  );

  const handleSelectAll = useCallback(
    (selected: boolean) => {
      setSelection((current) => ({
        queryFingerprint,
        selectedIds: selected ? limitSelection(uniqueAllIds, maxSelected) : [],
        isSelectionMode: current.queryFingerprint === queryFingerprint && current.isSelectionMode,
      }));
    },
    [maxSelected, queryFingerprint, uniqueAllIds]
  );

  const handleSelectMany = useCallback(
    (ids: readonly string[], selected: boolean) => {
      setSelection((current) => {
        const selectedIds = intersectSelection(
          current.queryFingerprint === queryFingerprint ? current.selectedIds : [],
          uniqueAllIdSet,
          maxSelected
        );
        const affected = new Set(ids.filter((id) => uniqueAllIdSet.has(id)));
        const nextIds = selected
          ? limitSelection(
              [...selectedIds, ...[...affected].filter((id) => !selectedIds.includes(id))],
              maxSelected
            )
          : selectedIds.filter((id) => !affected.has(id));
        return {
          queryFingerprint,
          selectedIds: nextIds,
          isSelectionMode: current.queryFingerprint === queryFingerprint && current.isSelectionMode,
        };
      });
    },
    [maxSelected, queryFingerprint, uniqueAllIdSet]
  );

  const toggleSelectionMode = useCallback(() => {
    setSelection((current) => {
      const wasSelectionMode =
        current.queryFingerprint === queryFingerprint && current.isSelectionMode;
      return {
        queryFingerprint,
        selectedIds:
          wasSelectionMode || current.queryFingerprint !== queryFingerprint
            ? []
            : intersectSelection(current.selectedIds, uniqueAllIdSet, maxSelected),
        isSelectionMode: !wasSelectionMode,
      };
    });
  }, [maxSelected, queryFingerprint, uniqueAllIdSet]);

  const clearSelection = useCallback(() => {
    setSelection((current) => ({
      queryFingerprint,
      selectedIds: [],
      isSelectionMode: current.queryFingerprint === queryFingerprint && current.isSelectionMode,
    }));
  }, [queryFingerprint]);

  const exitSelectionMode = useCallback(() => {
    setSelection({
      queryFingerprint,
      selectedIds: [],
      isSelectionMode: false,
    });
  }, [queryFingerprint]);

  const setSelectionMode = useCallback(
    (value: boolean) => {
      setSelection((current) => ({
        queryFingerprint,
        selectedIds:
          value && current.queryFingerprint === queryFingerprint
            ? intersectSelection(current.selectedIds, uniqueAllIdSet, maxSelected)
            : [],
        isSelectionMode: value,
      }));
    },
    [maxSelected, queryFingerprint, uniqueAllIdSet]
  );

  const toggleSelection = useCallback(
    (id: string) => {
      setSelection((current) => {
        const selectedIds = intersectSelection(
          current.queryFingerprint === queryFingerprint ? current.selectedIds : [],
          uniqueAllIdSet,
          maxSelected
        );
        return {
          queryFingerprint,
          selectedIds: selectedIds.includes(id)
            ? selectedIds.filter((selectedId) => selectedId !== id)
            : (maxSelected != null && selectedIds.length >= maxSelected) || !uniqueAllIdSet.has(id)
              ? selectedIds
              : [...selectedIds, id],
          isSelectionMode: current.queryFingerprint === queryFingerprint && current.isSelectionMode,
        };
      });
    },
    [maxSelected, queryFingerprint, uniqueAllIdSet]
  );

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (!active) return;
      setSelection((current) => {
        if (current.queryFingerprint !== queryFingerprint) {
          return {
            queryFingerprint,
            selectedIds: [],
            isSelectionMode: false,
          };
        }

        const nextSelectedIds = intersectSelection(
          current.selectedIds,
          uniqueAllIdSet,
          maxSelected
        );
        if (
          nextSelectedIds.length === current.selectedIds.length &&
          nextSelectedIds.every((id, index) => id === current.selectedIds[index])
        ) {
          return current;
        }
        return { ...current, selectedIds: nextSelectedIds };
      });
    });

    return () => {
      active = false;
    };
  }, [maxSelected, queryFingerprint, uniqueAllIdSet]);

  const selectAll = useCallback(() => {
    setSelection((current) => ({
      queryFingerprint,
      selectedIds: limitSelection(uniqueAllIds, maxSelected),
      isSelectionMode: current.queryFingerprint === queryFingerprint && current.isSelectionMode,
    }));
  }, [maxSelected, queryFingerprint, uniqueAllIds]);

  const retainSelection = useCallback(
    (ids: string[]) => {
      setSelection((current) => ({
        queryFingerprint,
        selectedIds: limitSelection(
          [...new Set(ids)].filter((id) => uniqueAllIdSet.has(id)),
          maxSelected
        ),
        isSelectionMode: current.queryFingerprint === queryFingerprint && current.isSelectionMode,
      }));
    },
    [maxSelected, queryFingerprint, uniqueAllIdSet]
  );

  useEffect(() => {
    if (!isSelectionMode) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;

      // Radix handles Escape for the topmost Dialog, Popover, Select, or
      // DropdownMenu first. Keep the underlying selection mode intact while
      // any such layer is open, including nested image viewers/confirmations.
      const openLayer = document.querySelector(
        [
          '[data-radix-dialog-content][data-state="open"]',
          '[data-radix-alert-dialog-content][data-state="open"]',
          '[data-radix-popover-content][data-state="open"]',
          '[data-radix-select-content][data-state="open"]',
          '[data-radix-menu-content][data-state="open"]',
          '[role="dialog"][data-state="open"]',
        ].join(", ")
      );
      if (openLayer != null) return;

      event.preventDefault();
      exitSelectionMode();
    };

    // Bubble phase is intentional: nested Radix layers retain priority.
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [exitSelectionMode, isSelectionMode]);

  return {
    selectedIds,
    isSelectionMode,
    isAllSelected,
    isSelectionLimitReached,
    selectableCount,
    selectedCount,
    handleSelect,
    handleSelectAll,
    handleSelectMany,
    toggleSelectionMode,
    clearSelection,
    exitSelectionMode,
    setSelectionMode,
    toggleSelection,
    selectAll,
    retainSelection,
  };
}
