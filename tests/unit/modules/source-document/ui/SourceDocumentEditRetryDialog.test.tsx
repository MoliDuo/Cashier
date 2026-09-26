import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchSourceDocumentInputMock } = vi.hoisted(() => ({
  fetchSourceDocumentInputMock: vi.fn(),
}));

vi.mock("@/modules/source-document/queries", () => ({
  fetchSourceDocumentInput: fetchSourceDocumentInputMock,
}));
vi.mock("@/modules/source-document/ui/SourceDocumentInput", () => ({
  SourceDocumentInput: ({
    onDirtyChange,
    onPendingChange,
  }: {
    onDirtyChange: (dirty: boolean) => void;
    onPendingChange: (pending: boolean) => void;
  }) => (
    <div data-testid="retry-input">
      <button onClick={() => onDirtyChange(true)}>edit</button>
      <button onClick={() => onPendingChange(true)}>submit</button>
      <button onClick={() => onPendingChange(false)}>settle</button>
    </div>
  ),
}));

import { SourceDocumentEditRetryDialog } from "@/modules/source-document/ui/SourceDocumentEditRetryDialog";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SourceDocumentEditRetryDialog
        sourceDocument={{
          id: "00000000-0000-4000-8000-000000000001",
          text: null,
          files: [],
          hasImages: true,
        }}
        open
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>
  );
}

describe("SourceDocumentEditRetryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUnsavedChangesStore.setState({ dirtyKeys: new Set(), leaveGuards: new Map() });
    fetchSourceDocumentInputMock.mockRejectedValue(new Error("unavailable"));
  });

  it("renders the load error and reloads without mounting an incomplete input", async () => {
    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载原始凭证");
    expect(screen.queryByTestId("retry-input")).not.toBeInTheDocument();

    fetchSourceDocumentInputMock.mockResolvedValue({ text: "receipt", files: [] });
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(screen.getByTestId("retry-input")).toBeInTheDocument());
  });

  it("registers only open content and protects global navigation while dirty or submitting", () => {
    const queryClient = new QueryClient();
    const onOpenChange = vi.fn();
    const props = {
      ledgerId: "ledger-1",
      sourceDocument: { id: "source-1", text: "Original" },
      onOpenChange,
    };
    const form = (open: boolean) => (
      <QueryClientProvider client={queryClient}>
        <SourceDocumentEditRetryDialog {...props} open={open} />
        <SourceDocumentEditRetryDialog
          {...props}
          sourceDocument={{ ...props.sourceDocument, id: "closed-source" }}
          open={false}
        />
      </QueryClientProvider>
    );
    const view = render(form(true));
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    const store = useUnsavedChangesStore.getState;
    const key = "source-document-retry-navigation";
    expect(store().dirtyKeys.has(key)).toBe(true);
    const leave = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    act(() => store().getLeaveGuard(key)?.requestLeave(leave));
    expect(screen.queryByRole("dialog", { name: "放弃更改？" })).not.toBeInTheDocument();
    expect(leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "settle" }));
    act(() => store().getLeaveGuard(key)?.requestLeave(leave));
    expect(screen.getByRole("dialog", { name: "放弃更改？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放弃并离开" }));
    expect(leave).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    view.rerender(form(false));
    expect(store().getLeaveGuard(key)).toBeNull();
    expect(store().dirtyKeys.has(key)).toBe(false);
  });
});
