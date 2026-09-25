import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import { LedgerEntryCard } from "@/modules/ledger/ui/LedgerEntryCard";

vi.mock("@/modules/currency/ui/AmountDisplay", () => ({
  AmountDisplay: () => <span>CNY 12.00</span>,
}));

const ledgerEntry: LedgerEntry = {
  id: "entry-1",
  ledgerId: "ledger-1",
  categoryId: null,
  sourceDocumentId: "document-1",
  amount: "12.00",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.00",
  exchangeRate: "1",
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  sourceDocument: {
    id: "document-1",
    version: 1,
    ledgerId: "ledger-1",
    title: "Lunch",
    documentDate: "2026-09-11",
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  },
};

describe("LedgerEntryCard", () => {
  it("renders an entry without exposing its creation source", () => {
    render(<LedgerEntryCard ledgerEntry={ledgerEntry} />);

    expect(screen.getByText("Lunch")).toBeInTheDocument();
    expect(screen.queryByText(/快速记账|Quick Entry/i)).not.toBeInTheDocument();
  });
});
