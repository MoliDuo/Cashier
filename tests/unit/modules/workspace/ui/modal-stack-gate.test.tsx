import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { loaderCalls } = vi.hoisted(() => ({ loaderCalls: vi.fn() }));

vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (
      loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>,
      options: { loading: React.ComponentType }
    ) =>
      function DynamicComponent(props: Record<string, unknown>) {
        const [Loaded, setLoaded] = React.useState<React.ComponentType<
          Record<string, unknown>
        > | null>(null);
        React.useEffect(() => {
          loaderCalls();
          void loader().then((module) => setLoaded(() => module.default));
        }, []);
        return Loaded == null ? <options.loading /> : <Loaded {...props} />;
      },
  };
});
vi.mock("@/modules/workspace/ui/ModalStackLoadingFallback", () => ({
  ModalStackLoadingFallback: () => <div>Loading detail</div>,
}));
vi.mock("@/modules/workspace/ui/ModalStackRenderer", () => ({
  ModalStackRenderer: () => <div>Loaded detail</div>,
}));

import { useModalStackStore } from "@/lib/store/modal-stack";
import { ModalStackGate } from "@/modules/workspace/ui/ModalStackGate";

const props = {
  books: [],
  categories: [],
  mainCurrency: "CNY",
  preferredCurrencies: [],
};

afterEach(() => {
  useModalStackStore.getState().closeAll();
  loaderCalls.mockClear();
});

describe("ModalStackGate", () => {
  it("does not invoke the detail loader for an empty stack", () => {
    render(<ModalStackGate {...props} />);

    expect(loaderCalls).not.toHaveBeenCalled();
    expect(screen.queryByText("Loading detail")).not.toBeInTheDocument();
  });

  it("loads the renderer once after a modal is pushed", async () => {
    render(<ModalStackGate {...props} />);

    act(() => {
      useModalStackStore.getState().push({
        type: "source-document",
        id: "document-1",
        ledgerId: "ledger-1",
      });
    });

    expect(screen.getByText("Loading detail")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Loaded detail")).toBeInTheDocument());
    expect(loaderCalls).toHaveBeenCalledTimes(1);

    act(() => {
      useModalStackStore.getState().push({
        type: "source-document",
        id: "document-2",
        ledgerId: "ledger-1",
      });
    });
    expect(loaderCalls).toHaveBeenCalledTimes(1);
  });

  it("shows the fallback for a deep-linked detail while the renderer loads", async () => {
    useModalStackStore.getState().syncToDetail({
      type: "source-document",
      id: "document-1",
      ledgerId: "ledger-1",
    });

    render(<ModalStackGate {...props} />);

    expect(screen.getByText("Loading detail")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Loaded detail")).toBeInTheDocument());
  });
});
