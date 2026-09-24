import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { SourceDocumentDetailFooterActions } from "@/modules/source-document/ui/SourceDocumentDetailFooterActions";

const sourceDocument = {
  supportedActions: ["edit_retry"],
} as unknown as SourceDocument;

const baseProps = {
  sourceDocument,
  isEditMode: false,
  isSelectionMode: false,
  busy: false,
  interactionDisabled: false,
  hasPendingChanges: false,
  pendingChangesCount: 0,
  isCancelling: false,
  onOpenRetryDialog: vi.fn(),
  onRequestDelete: vi.fn(),
  onCancelEditMode: vi.fn(),
  onEditSave: vi.fn(async () => true),
  onEnterEditMode: vi.fn(),
};

describe("SourceDocumentDetailFooterActions", () => {
  it("omits the evidence button unless the owner offers the evidence pane", () => {
    render(<SourceDocumentDetailFooterActions {...baseProps} />);

    expect(screen.queryByRole("button", { name: "原始凭证" })).not.toBeInTheDocument();
  });

  it("orders the evidence, retry, and delete actions and calls back", () => {
    const onViewEvidence = vi.fn();
    render(<SourceDocumentDetailFooterActions {...baseProps} onViewEvidence={onViewEvidence} />);

    const evidenceButton = screen.getByRole("button", { name: "原始凭证" });
    const retryButton = screen.getByRole("button", { name: "编辑重试" });
    const deleteButton = screen.getByRole("button", { name: "删除" });

    expect(evidenceButton.nextElementSibling).toBe(retryButton);
    expect(retryButton.nextElementSibling).toBe(deleteButton);
    // Desktop shows both panes, so the toggle is mobile-only.
    expect(evidenceButton).toHaveClass("lg:hidden");

    fireEvent.click(evidenceButton);
    expect(onViewEvidence).toHaveBeenCalledTimes(1);
  });
});
