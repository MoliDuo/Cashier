import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const showSuccessMock = vi.hoisted(() => vi.fn());

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
          void loader().then((module) => setLoaded(() => module.default));
        }, []);
        return Loaded == null ? <options.loading /> : <Loaded {...props} />;
      },
  };
});

vi.mock("@/lib/safe-prefetch", () => ({
  safePrefetch: vi.fn(),
}));

vi.mock("@/modules/workspace/ui/new-record-success-feedback", () => ({
  showNewRecordSuccessFeedback: showSuccessMock,
}));

type SourceDocumentInputProps = {
  bookId: string;
  onSuccess?: (result: { sourceDocumentId: string; documentDate: string }) => void;
};

vi.mock("@/modules/source-document/ui/SourceDocumentInput", () => ({
  SourceDocumentInput: (props: SourceDocumentInputProps) => (
    <button
      type="button"
      data-testid="record-save"
      data-book-id={props.bookId}
      onClick={() => props.onSuccess?.({ sourceDocumentId: "doc-1", documentDate: "2026-09-19" })}
    >
      save
    </button>
  ),
}));

import { NewRecordForms } from "@/modules/workspace/ui/NewRecordForms";

const BOOK_ID = "10000000-0000-4000-8000-000000000002";

const baseProps = {
  viewedBookId: null as string | null,
  savedBook: { id: BOOK_ID, name: "Travel" } as { id: string; name: string } | null,
  activeTab: "records" as const,
  committedView: { filters: {}, range: null },
  onSaved: vi.fn(),
  onPendingChange: vi.fn(),
  bookPicker: null,
  closeControl: null,
};

describe("NewRecordForms picker memory", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("remembers the saved book after a successful save", async () => {
    render(<NewRecordForms {...baseProps} bookId={BOOK_ID} />);
    fireEvent.click(await screen.findByTestId("record-save"));

    expect(window.localStorage.getItem("cashier:new-record-book")).toBe(BOOK_ID);
  });

  it("closes the dialog after a save", async () => {
    render(<NewRecordForms {...baseProps} bookId={BOOK_ID} />);
    fireEvent.click(await screen.findByTestId("record-save"));

    expect(baseProps.onSaved).toHaveBeenCalledOnce();
  });

  it("does not touch the memory when the save never succeeds", async () => {
    render(<NewRecordForms {...baseProps} bookId={BOOK_ID} />);
    await screen.findByTestId("record-save");

    // No save: rendering and unmounting the form is not a choice.
    expect(window.localStorage.getItem("cashier:new-record-book")).toBeNull();
  });
});
