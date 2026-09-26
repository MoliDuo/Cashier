import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceDocumentTotal } from "@/modules/source-document/ui/SourceDocumentViewDetails/components/SourceDocumentTotal";
import { expectAmountVariant } from "tests/helpers/class-tables";

function renderTotal(staleConversionCount = 0, unconvertedCount = 0) {
  return render(
    <SourceDocumentTotal
      totalInMainCurrency="92.00"
      mainCurrency="CNY"
      staleConversionCount={staleConversionCount}
      unconvertedCount={unconvertedCount}
    />
  );
}

describe("SourceDocumentTotal", () => {
  it("shows the total as a bare amount", () => {
    const { container } = renderTotal();

    expect(container.textContent).toBe("¥92.00");
    // A bare amount, written like the ledger stream toolbar's total: the same
    // variant, not merely the same size as it happens to be set today.
    expectAmountVariant(screen.getByText("¥92.00"), "summary");
    expect(container.textContent).not.toContain("=");
  });

  it("marks an approximate total and notes a pending recalculation", () => {
    const { container } = renderTotal(1);

    expect(container.textContent).toContain("≈");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
