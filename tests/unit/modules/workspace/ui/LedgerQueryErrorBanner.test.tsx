import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ledgerQueryErrorCopy } from "@/copy/app";
import { LedgerQueryErrorBanner } from "@/modules/workspace/ui/LedgerQueryErrorBanner";

describe("LedgerQueryErrorBanner", () => {
  it("delegates retry to the active-tab retry callback", () => {
    const onRetry = vi.fn();
    render(<LedgerQueryErrorBanner onRetry={onRetry} />);

    expect(screen.getByText(ledgerQueryErrorCopy.description)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ledgerQueryErrorCopy.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders the standalone first-load error message", () => {
    render(<LedgerQueryErrorBanner empty onRetry={vi.fn()} />);

    expect(screen.getByText(ledgerQueryErrorCopy.emptyDescription)).toBeInTheDocument();
    expect(screen.queryByText(ledgerQueryErrorCopy.description)).not.toBeInTheDocument();
  });
});
