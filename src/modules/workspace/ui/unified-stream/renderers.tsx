import { cn } from "@/lib/utils";
import type { UnifiedStreamGroup } from "@/modules/source-document/stream-grouping";
import { useCallback, useState, type ReactNode } from "react";
import { UnifiedGroupHeader, type UnifiedGroupHeaderSelection } from "./group-header";
import { StreamItemRow } from "./stream-item-row";
import type { RendererProps } from "./types";

/**
 * A day's own checkbox: the cards it opens, and what the band should do with
 * them. Absent outside selection mode, where the band is plain text.
 */
function groupSelectionFor(
  group: UnifiedStreamGroup,
  props: RendererProps
): UnifiedGroupHeaderSelection | undefined {
  if (!props.isSelectionMode || props.onSetGroupSelection == null) return undefined;
  return {
    ids: group.items.map((item) => item.sourceDocument.id),
    selectedIdSet: props.selectedIdSet,
    disabled: props.disableUnselected === true,
    onSelectMany: props.onSetGroupSelection,
  };
}

/**
 * The stream's bills under their day headers. The list is not virtualized and
 * cards do not glide between positions: a ledger for two people pages twenty
 * bills at a time, and a plain list is what keeps scrolling, restoring and
 * selecting predictable. A bill that arrives after the list first showed fades
 * in, so a new record is noticed without moving the others.
 */
export function InteractiveUnifiedGroups(props: RendererProps) {
  const [expandedById, setExpandedById] = useState(() => new Map<string, boolean>());
  const defaultExpanded = !props.collapseEntriesDefault;
  const getExpanded = useCallback(
    (sourceDocumentId: string) => expandedById.get(sourceDocumentId) ?? defaultExpanded,
    [defaultExpanded, expandedById]
  );
  const onExpandedChange = useCallback((sourceDocumentId: string, expanded: boolean) => {
    setExpandedById((current) => {
      const next = new Map(current);
      next.set(sourceDocumentId, expanded);
      return next;
    });
  }, []);
  // The bills on screen when the list first showed; any other one arrived since.
  const [initialIds] = useState(
    () =>
      new Set(
        props.streamGroups.flatMap((group) => group.items.map((item) => item.sourceDocument.id))
      )
  );
  const children: ReactNode[] = [];

  for (const dateGroup of props.streamGroups) {
    const selection = groupSelectionFor(dateGroup, props);
    children.push(
      <UnifiedGroupHeader
        key={`header:${dateGroup.date}`}
        group={dateGroup}
        mainCurrency={props.mainCurrency}
        {...(props.timeZone != null ? { timeZone: props.timeZone } : {})}
        {...(selection == null ? {} : { selection })}
      />
    );
    for (const item of dateGroup.items) {
      const id = item.sourceDocument.id;
      children.push(
        <div
          key={id}
          data-stream-card-id={id}
          className={cn(!initialIds.has(id) && "stream-card-enter")}
        >
          <StreamItemRow
            item={item}
            props={props}
            expanded={getExpanded(id)}
            onExpandedChange={onExpandedChange}
          />
        </div>
      );
    }
  }

  // One flat list of headers and cards, so a date header keeps the same gap
  // above it as the cards do and the header's own padding makes up the group
  // band. The flat child list is deliberate — grouping the cards under a
  // per-date element would remount a card whose date changes.
  return <div className="space-y-4">{children}</div>;
}
