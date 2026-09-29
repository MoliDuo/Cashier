import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceStoreProvider,
  useHeaderSelection,
  useWorkspaceStore,
  type HeaderSelection,
} from "@/modules/workspace/store";

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceStoreProvider initialBookId={null}>{children}</WorkspaceStoreProvider>;
}

const base = {
  active: true,
  disabled: false,
  selectedCount: 1,
  loadedCount: 4,
  hasMore: false,
  allSelected: "indeterminate" as const,
};

function renderSelection(initial: Parameters<typeof useHeaderSelection>[0]) {
  return renderHook(
    (props: Parameters<typeof useHeaderSelection>[0]) => {
      useHeaderSelection(props);
      return useWorkspaceStore((state) => state.headerSelection);
    },
    { wrapper, initialProps: initial }
  );
}

describe("useHeaderSelection", () => {
  it("publishes the list's selection to the store", () => {
    const { result } = renderSelection({ ...base, onToggle: vi.fn(), onToggleAll: vi.fn() });

    expect(result.current).toMatchObject({ active: true, selectedCount: 1, loadedCount: 4 });
  });

  it("keeps the commands stable across renders and calls the latest ones", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderSelection({
      ...base,
      onToggle: first,
      onToggleAll: vi.fn(),
    });
    const published = result.current as HeaderSelection;

    rerender({ ...base, selectedCount: 2, onToggle: second, onToggleAll: vi.fn() });
    const next = result.current as HeaderSelection;
    expect(next.selectedCount).toBe(2);
    expect(next.onToggle).toBe(published.onToggle);

    act(() => next.onToggle());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("takes the selection down when the list leaves", () => {
    function Publisher() {
      useHeaderSelection({ ...base, onToggle: vi.fn(), onToggleAll: vi.fn() });
      return null;
    }
    function Probe() {
      const selection = useWorkspaceStore((state) => state.headerSelection);
      return <span data-testid="probe">{selection == null ? "none" : "selecting"}</span>;
    }
    const { rerender } = render(
      <WorkspaceStoreProvider initialBookId={null}>
        <Publisher />
        <Probe />
      </WorkspaceStoreProvider>
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("selecting");

    rerender(
      <WorkspaceStoreProvider initialBookId={null}>
        <Probe />
      </WorkspaceStoreProvider>
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("none");
  });
});
