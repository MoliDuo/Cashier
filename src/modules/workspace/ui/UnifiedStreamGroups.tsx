import { useMemo } from "react";
import { InteractiveUnifiedGroups } from "./unified-stream/renderers";
import type { UnifiedStreamGroupProps } from "./unified-stream/types";

export type { UnifiedStreamGroupProps } from "./unified-stream/types";

export function LedgerEntriesUnifiedGroups({
  disableUnselected = false,
  collapseEntriesDefault = false,
  ...props
}: UnifiedStreamGroupProps) {
  const selectedIdSet = useMemo(() => new Set(props.selectedIds), [props.selectedIds]);

  const rendererProps = {
    ...props,
    selectedIdSet,
    disableUnselected,
    collapseEntriesDefault,
  };

  return <InteractiveUnifiedGroups {...rendererProps} />;
}
