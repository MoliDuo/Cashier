import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BookDto } from "@/modules/ledger/contracts";

vi.mock("@/i18n/DeferredFeatureMessages", () => ({
  DeferredFeatureMessages: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/modules/workspace/ui/NewRecordForms", () => ({
  InputFormLoadingFallback: () => null,
  NewRecordForms: (props: {
    bookId: string;
    viewedBookId: string | null;
    savedBook: { id: string; name: string } | null;
    timeZone?: string;
  }) => (
    <div
      data-testid="record-forms"
      data-book-id={props.bookId}
      data-viewed-book-id={props.viewedBookId ?? ""}
      data-saved-book={
        props.savedBook == null ? "" : `${props.savedBook.id}:${props.savedBook.name}`
      }
      data-time-zone={props.timeZone ?? ""}
    />
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    children: ReactNode;
  }) => (
    <select
      data-testid="book-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectValue: () => null,
}));

import { NewRecordDialog } from "@/modules/workspace/ui/NewRecordDialog";

const ledgerId = "ledger-1";

function createBook(overrides: Partial<BookDto>): BookDto {
  return {
    id: "book-a",
    ledgerId,
    name: "Daily",
    timeZone: "Asia/Shanghai",
    sortOrder: 0,
    isDefault: true,
    archivedAt: null,
    ...overrides,
  };
}

const defaultBooks: BookDto[] = [
  createBook({}),
  createBook({
    id: "book-b",
    name: "Travel",
    timeZone: "America/Los_Angeles",
    sortOrder: 1,
    isDefault: false,
    archivedAt: null,
  }),
];

function renderDialog(overrides: Partial<Parameters<typeof NewRecordDialog>[0]> = {}) {
  const props: Parameters<typeof NewRecordDialog>[0] = {
    scope: null,
    books: defaultBooks,
    isOpen: false,
    onOpenChange: vi.fn(),
    isSubmitting: false,
    locale: "zh",
    ledgerId,
    activeTab: "stream",
    committedFilters: {},
    inputMode: "quick",
    setInputMode: vi.fn(),
    categories: [],
    mainCurrency: "CNY",
    preferredCurrencies: [],
    aiDirty: false,
    quickDirty: false,
    setInputOpen: vi.fn(),
    setAiPending: vi.fn(),
    setQuickPending: vi.fn(),
    setAiDirty: vi.fn(),
    setQuickDirty: vi.fn(),
    deviceTimeZone: "Europe/Berlin",
    ...overrides,
  };
  const view = render(<NewRecordDialog {...props} />);
  const open = (extra: Partial<Parameters<typeof NewRecordDialog>[0]> = {}) => {
    view.rerender(<NewRecordDialog {...props} {...extra} isOpen />);
    return screen.getByTestId("record-forms");
  };
  return { view, props, open };
}

function formsAttrs() {
  const forms = screen.getByTestId("record-forms");
  return {
    bookId: forms.getAttribute("data-book-id") ?? "",
    viewedBookId: forms.getAttribute("data-viewed-book-id") ?? "",
    savedBook: forms.getAttribute("data-saved-book") ?? "",
    timeZone: forms.getAttribute("data-time-zone") ?? "",
  };
}

describe("NewRecordDialog book picker", () => {
  it("gives the forms the picked book's zone, not the viewed book's", () => {
    const { open } = renderDialog({ scope: "book-b" });
    open();

    expect(formsAttrs()).toMatchObject({
      bookId: "book-b",
      viewedBookId: "book-b",
      savedBook: "book-b:Travel",
      timeZone: "America/Los_Angeles",
    });

    fireEvent.change(screen.getByTestId("book-select"), { target: { value: "book-a" } });

    expect(formsAttrs()).toMatchObject({
      bookId: "book-a",
      savedBook: "book-a:Daily",
      timeZone: "Asia/Shanghai",
    });
  });

  it("falls back to the device zone for a book without its own zone", () => {
    const books = [createBook({ timeZone: null }), defaultBooks[1]!];
    const { open } = renderDialog({ books });
    open();

    expect(formsAttrs().timeZone).toBe("Europe/Berlin");
  });

  it("resets the pick to the default book every time the dialog opens", () => {
    const { view, props, open } = renderDialog({ scope: "book-a" });
    open();
    fireEvent.change(screen.getByTestId("book-select"), { target: { value: "book-b" } });
    expect(formsAttrs().bookId).toBe("book-b");

    view.rerender(<NewRecordDialog {...props} isOpen={false} />);
    open();

    expect(formsAttrs().bookId).toBe("book-a");
  });

  it("keeps the pick when the books refetch while the dialog stays open", () => {
    const { view, props, open } = renderDialog({ scope: "book-a" });
    open();
    fireEvent.change(screen.getByTestId("book-select"), { target: { value: "book-b" } });

    view.rerender(
      <NewRecordDialog
        {...props}
        isOpen
        books={[createBook({ name: "Household" }), defaultBooks[1]!]}
      />
    );

    expect(formsAttrs()).toMatchObject({ bookId: "book-b", savedBook: "book-b:Travel" });
  });

  it("resolves to the default book when the pick is not (yet) live", () => {
    const { view, props, open } = renderDialog({ books: [] });
    open();

    view.rerender(<NewRecordDialog {...props} isOpen books={defaultBooks} />);

    expect(formsAttrs()).toMatchObject({
      bookId: "book-a",
      savedBook: "book-a:Daily",
      timeZone: "Asia/Shanghai",
    });
  });
});
