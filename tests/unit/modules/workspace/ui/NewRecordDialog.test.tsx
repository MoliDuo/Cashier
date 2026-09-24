import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookDto } from "@/modules/ledger/contracts";
import { writeLastNewRecordBookId } from "@/modules/workspace/new-record-book-memory";

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
const BOOK_A = "10000000-0000-4000-8000-000000000001";
const BOOK_B = "10000000-0000-4000-8000-000000000002";

function createBook(overrides: Partial<BookDto>): BookDto {
  return {
    id: BOOK_A,
    ledgerId,
    name: "Daily",
    timeZone: "Asia/Shanghai",
    sortOrder: 0,
    archivedAt: null,
    ...overrides,
  };
}

const defaultBooks: BookDto[] = [
  createBook({}),
  createBook({
    id: BOOK_B,
    name: "Travel",
    timeZone: "America/Los_Angeles",
    sortOrder: 1,
  }),
];

function renderDialog(overrides: Partial<Parameters<typeof NewRecordDialog>[0]> = {}) {
  const props: Parameters<typeof NewRecordDialog>[0] = {
    scope: null,
    books: defaultBooks,
    isOpen: false,
    onOpenChange: vi.fn(),
    isSubmitting: false,
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
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("opens on the first book in 设置 order when nothing is remembered", () => {
    const { open } = renderDialog({});
    open();

    expect(formsAttrs()).toMatchObject({ bookId: BOOK_A, savedBook: `${BOOK_A}:Daily` });
  });

  it("gives the forms the picked book's zone, not the viewed book's", () => {
    const { open } = renderDialog({ scope: BOOK_B });
    open();

    expect(formsAttrs()).toMatchObject({
      bookId: BOOK_A,
      viewedBookId: BOOK_B,
      timeZone: "Asia/Shanghai",
    });

    fireEvent.change(screen.getByTestId("book-select"), { target: { value: BOOK_B } });

    expect(formsAttrs()).toMatchObject({
      bookId: BOOK_B,
      savedBook: `${BOOK_B}:Travel`,
      timeZone: "America/Los_Angeles",
    });
  });

  it("falls back to the device zone for a book without its own zone", () => {
    const books = [createBook({ timeZone: null }), defaultBooks[1]!];
    const { open } = renderDialog({ books });
    open();

    expect(formsAttrs().timeZone).toBe("Europe/Berlin");
  });

  it("opens on the last saved book when it is still live", () => {
    writeLastNewRecordBookId(BOOK_B);
    const { open } = renderDialog({});
    open();

    expect(formsAttrs()).toMatchObject({
      bookId: BOOK_B,
      savedBook: `${BOOK_B}:Travel`,
      timeZone: "America/Los_Angeles",
    });
  });

  it("falls back to the first book when the remembered book is gone", () => {
    writeLastNewRecordBookId("10000000-0000-4000-8000-00000000dead");
    const { open } = renderDialog({});
    open();

    expect(formsAttrs().bookId).toBe(BOOK_A);
  });

  it("keeps the pick when the books refetch while the dialog stays open", () => {
    const { view, props, open } = renderDialog({ scope: BOOK_A });
    open();
    fireEvent.change(screen.getByTestId("book-select"), { target: { value: BOOK_B } });

    view.rerender(
      <NewRecordDialog
        {...props}
        isOpen
        books={[createBook({ name: "Household" }), defaultBooks[1]!]}
      />
    );

    expect(formsAttrs()).toMatchObject({ bookId: BOOK_B, savedBook: `${BOOK_B}:Travel` });
  });

  it("resets to the remembered pick every time the dialog opens", () => {
    writeLastNewRecordBookId(BOOK_B);
    const { view, props, open } = renderDialog({});
    open();
    fireEvent.change(screen.getByTestId("book-select"), { target: { value: BOOK_A } });
    expect(formsAttrs().bookId).toBe(BOOK_A);

    view.rerender(<NewRecordDialog {...props} isOpen={false} />);
    open();

    expect(formsAttrs().bookId).toBe(BOOK_B);
  });

  it("resolves to the first book when the pick is not (yet) live", () => {
    const { view, props, open } = renderDialog({ books: [] });
    open();

    view.rerender(<NewRecordDialog {...props} isOpen books={defaultBooks} />);

    expect(formsAttrs()).toMatchObject({
      bookId: BOOK_A,
      savedBook: `${BOOK_A}:Daily`,
      timeZone: "Asia/Shanghai",
    });
  });
});
