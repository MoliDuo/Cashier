import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SourceDocumentDetailConfirmDialogs } from "@/modules/source-document/ui/SourceDocumentDetailConfirmDialogs";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function SourceDocumentDialogHarness({ onConfirm }: { onConfirm: () => Promise<boolean> }) {
  const [parentOpen, setParentOpen] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(true);
  return (
    <Dialog open={parentOpen} onOpenChange={setParentOpen}>
      <DialogContent variant="detail" aria-describedby={undefined}>
        <DialogTitle>Bill details</DialogTitle>
        <span>Parent content</span>
        <SourceDocumentDetailConfirmDialogs
          showBatchModePendingConfirm={false}
          setShowBatchModePendingConfirm={vi.fn()}
          handleSaveAndEnterBatchMode={async () => true}
          handleDiscardAndEnterBatchMode={vi.fn()}
          showBatchDeleteConfirm={false}
          setShowBatchDeleteConfirm={vi.fn()}
          selectedCount={0}
          handleBatchDelete={async () => undefined}
          pendingDeleteEntryId={null}
          setPendingDeleteEntryId={vi.fn()}
          handleDeleteEntry={async () => true}
          showDeleteConfirm={false}
          setShowDeleteConfirm={vi.fn()}
          handleDeleteDocument={async () => undefined}
          saveAndContinueGate={{
            confirmOpen,
            setConfirmOpen,
            confirmSaveAndContinue: onConfirm,
            confirmDiscardAndContinue: async () => true,
          }}
          discardEditsGate={{ confirmOpen: false, setConfirmOpen: vi.fn() }}
          handleConfirmDiscardEdits={vi.fn()}
        />
      </DialogContent>
    </Dialog>
  );
}

describe("source-document dialog control flows", () => {
  it("locks a pending confirmation and closes after success", async () => {
    const confirmation = deferred<boolean>();
    render(<SourceDocumentDialogHarness onConfirm={() => confirmation.promise} />);

    fireEvent.click(screen.getByRole("button", { name: "saveAndContinue" }));
    expect(screen.getByRole("button", { name: "saveAndContinue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "continueEditing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "discardChanges" })).toBeDisabled();

    confirmation.resolve(true);
    await waitFor(() =>
      expect(screen.queryByText("saveBeforeActionTitle")).not.toBeInTheDocument()
    );
    expect(screen.getByText("Parent content")).toBeInTheDocument();
  });

  it("keeps the confirmation open when the action returns false", async () => {
    render(<SourceDocumentDialogHarness onConfirm={async () => false} />);

    fireEvent.click(screen.getByRole("button", { name: "saveAndContinue" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "saveAndContinue" })).not.toBeDisabled()
    );
    expect(screen.getByText("saveBeforeActionTitle")).toBeInTheDocument();
  });

  it("closes only the nested confirmation when cancelled", async () => {
    render(<SourceDocumentDialogHarness onConfirm={async () => true} />);
    expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "continueEditing" }));

    await waitFor(() => expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1));
    expect(screen.getByText("Parent content")).toBeInTheDocument();
  });
});
