import { cn } from "@/lib/utils";
import type { UnifiedStreamGroup } from "@/modules/source-document/stream-grouping";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStreamListMotion, type StreamListMotionApi } from "../use-stream-list-motion";
import { UnifiedGroupHeader, type UnifiedGroupHeaderSelection } from "./group-header";
import { StreamItemRow } from "./stream-item-row";
import type { ControlledRendererProps, RendererProps } from "./types";

const VIRTUALIZATION_THRESHOLD = 80;

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

export function StaticUnifiedGroups(props: RendererProps & { readOnly: true }) {
  return (
    <div className="space-y-4">
      {props.streamGroups.map((dateGroup) => (
        <div key={dateGroup.date} className="ledger-list-group space-y-2">
          <UnifiedGroupHeader
            group={dateGroup}
            mainCurrency={props.mainCurrency}
            {...(props.timeZone != null ? { timeZone: props.timeZone } : {})}
          />
          <div className="space-y-4 px-2">
            {dateGroup.items.map((item) => (
              <StreamItemRow key={item.sourceDocument.id} item={item} props={props} readOnly />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

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
  const documentCount = props.streamGroups.reduce((total, group) => total + group.items.length, 0);
  const controlledProps = { ...props, getExpanded, onExpandedChange };

  return documentCount <= VIRTUALIZATION_THRESHOLD ? (
    <AnimatedInteractiveGroups {...controlledProps} />
  ) : (
    <VirtualizedInteractiveGroups {...controlledProps} />
  );
}

function AnimatedInteractiveGroups(props: ControlledRendererProps) {
  const motionItems = useMemo(
    () =>
      props.streamGroups.flatMap((dateGroup) =>
        dateGroup.items.map((item) => ({
          id: item.sourceDocument.id,
          date: dateGroup.date,
          revision: `${item.sourceDocument.version}:${item.sourceDocument.updatedAt}`,
        }))
      ),
    [props.streamGroups]
  );
  const expansionLayoutKey = motionItems
    .filter((item) => props.getExpanded(item.id))
    .map((item) => item.id)
    .join(",");
  const motion = useStreamListMotion(motionItems, expansionLayoutKey);
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
      children.push(
        <StreamCardMotion
          key={item.sourceDocument.id}
          id={item.sourceDocument.id}
          registerNode={motion.registerNode}
          isEntering={!motion.reducedMotion && motion.entering.has(item.sourceDocument.id)}
        >
          <StreamItemRow
            item={item}
            props={props}
            readOnly={false}
            expanded={props.getExpanded(item.sourceDocument.id)}
            onExpandedChange={props.onExpandedChange}
          />
        </StreamCardMotion>
      );
    }
  }

  // One flat list of headers and cards, so a date header keeps the same gap
  // above it as the cards do and the header's own padding makes up the group
  // band. The flat child list is deliberate — grouping the cards under a
  // per-date element would remount a card whose date changes.
  return <div className="space-y-4">{children}</div>;
}

type VirtualStreamRow =
  | { key: string; kind: "header"; group: UnifiedStreamGroup }
  | { key: string; kind: "card"; item: UnifiedStreamGroup["items"][number] };

function flattenStreamGroups(groups: readonly UnifiedStreamGroup[]): VirtualStreamRow[] {
  return groups.flatMap((group) => [
    {
      key: `header:${group.date}:${group.items[0]?.sourceDocument.id ?? "empty"}`,
      kind: "header" as const,
      group,
    },
    ...group.items.map((item) => ({
      key: item.sourceDocument.id,
      kind: "card" as const,
      item,
    })),
  ]);
}

function VirtualizedInteractiveGroups(props: ControlledRendererProps) {
  const rows = useMemo(() => flattenStreamGroups(props.streamGroups), [props.streamGroups]);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list == null) return;
    const update = () => setScrollMargin(list.getBoundingClientRect().top + window.scrollY);
    update();
    window.addEventListener("resize", update);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (resizeObserver != null) {
      let current: Element | null = list;
      while (current != null) {
        resizeObserver.observe(current);
        for (
          let sibling = current.previousElementSibling;
          sibling != null;
          sibling = sibling.previousElementSibling
        ) {
          resizeObserver.observe(sibling);
        }
        current = current.parentElement;
      }
    }
    return () => {
      window.removeEventListener("resize", update);
      resizeObserver?.disconnect();
    };
  }, []);
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (index) => {
      const row = rows[index];
      if (row == null || row.kind === "header") return 48;
      if (!props.getExpanded(row.item.sourceDocument.id)) return 88;
      return 96 + 72 * row.item.ledgerEntries.length;
    },
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 6,
    scrollMargin,
  });

  return (
    <div
      ref={listRef}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
      data-testid="virtualized-source-document-stream"
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (row == null) return null;
        const selection = row.kind === "header" ? groupSelectionFor(row.group, props) : undefined;
        return (
          <div
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
          >
            {row.kind === "header" ? (
              <UnifiedGroupHeader
                group={row.group}
                mainCurrency={props.mainCurrency}
                {...(props.timeZone != null ? { timeZone: props.timeZone } : {})}
                {...(selection == null ? {} : { selection })}
              />
            ) : (
              <div className="px-2 pb-4">
                <StreamItemRow
                  item={row.item}
                  props={props}
                  readOnly={false}
                  expanded={props.getExpanded(row.item.sourceDocument.id)}
                  onExpandedChange={props.onExpandedChange}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StreamCardMotion({
  id,
  registerNode,
  isEntering,
  children,
}: {
  id: string;
  registerNode: StreamListMotionApi["registerNode"];
  isEntering: boolean;
  children: ReactNode;
}) {
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => registerNode(id, node),
    [id, registerNode]
  );
  return (
    <div
      ref={setNodeRef}
      data-stream-card-id={id}
      className={cn("px-2", isEntering && "stream-card-enter")}
    >
      {children}
    </div>
  );
}
