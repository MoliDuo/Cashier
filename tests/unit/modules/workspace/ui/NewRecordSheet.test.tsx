import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commonCopy } from "@/copy/common";
import type { BookDto } from "@/modules/ledger/contracts";
import { writeLastNewRecordBookId } from "@/modules/workspace/new-record-book-memory";

vi.mock("@/modules/workspace/ui/NewRecordForms", () => ({
  InputFormLoadingFallback: () => null,
  NewRecordForms: (props: {
    bookId: string;
    viewedBookId: string | null;
    savedBook: { id: string; name: string } | null;
    timeZone?: string;
    onPendingChange: (pending: boolean) => void;
    onSaved: () => void;
    bookPicker: ReactNode;
    closeControl: ReactNode;
  }) => (
    <div
      data-testid="record-forms"
      data-book-id={props.bookId}
      data-viewed-book-id={props.viewedBookId ?? ""}
      data-saved-book={
        props.savedBook == null ? "" : `${props.savedBook.id}:${props.savedBook.name}`
      }
      data-time-zone={props.timeZone ?? ""}
    >
      {props.closeControl}
      {props.bookPicker}
      <button type="button" onClick={() => props.onPendingChange(true)}>
        start submit
      </button>
      <button type="button" onClick={() => props.onPendingChange(false)}>
        settle submit
      </button>
      <button type="button" onClick={() => props.onSaved()}>
        saved
      </button>
    </div>
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

import { NewRecordSheet } from "@/modules/workspace/ui/NewRecordSheet";

const ledgerId = "ledger-1";
const BOOK_A = "10000000-0000-4000-8000-000000000001";
const BOOK_B = "10000000-0000-4000-8000-000000000002";

function createBook(overrides: Partial<BookDto>): BookDto {
  return {
    id: BOOK_A,
    ledgerId,
    name: "Daily",
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
    sortOrder: 1,
  }),
];

type DialogProps = Parameters<typeof NewRecordSheet>[0];

const onClose = vi.fn();

beforeEach(() => onClose.mockClear());

/**
 * Stands in for the URL: the test opens the dialog as the + button's `?new=1`
 * would, and a close lands the way the popped entry would.
 */
function UrlBackedDialog({ open, ...props }: DialogProps) {
  const [isOpen, setIsOpen] = useState(open);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    setIsOpen(open);
  }
  return (
    <NewRecordSheet
      {...props}
      open={isOpen}
      onClose={() => {
        onClose();
        setIsOpen(false);
      }}
    />
  );
}

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const props: DialogProps = {
    open: false,
    onClose,
    scope: null,
    books: defaultBooks,
    activeTab: "records",
    committedView: { filters: {}, range: null },
    timeZone: "Europe/Berlin",
    ...overrides,
  };
  const tree = (isOpen: boolean, extra: Partial<DialogProps> = {}) => (
    <UrlBackedDialog {...props} {...extra} open={isOpen} />
  );
  const view = render(tree(false));
  const rerender = (isOpen: boolean, extra: Partial<DialogProps> = {}) =>
    view.rerender(tree(isOpen, extra));
  const open = (extra: Partial<DialogProps> = {}) => {
    rerender(true, extra);
    return screen.getByTestId("record-forms");
  };
  return { view, open, rerender };
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

describe("NewRecordSheet book picker", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("opens on the first book in 设置 order when nothing is remembered", () => {
    const { open } = renderDialog({});
    open();

    expect(formsAttrs()).toMatchObject({ bookId: BOOK_A, savedBook: `${BOOK_A}:Daily` });
  });

  it("opens on the book being viewed, ahead of the remembered one", () => {
    writeLastNewRecordBookId(BOOK_A);
    const { open } = renderDialog({ scope: BOOK_B });
    open();

    expect(formsAttrs()).toMatchObject({ bookId: BOOK_B, viewedBookId: BOOK_B });
  });

  it("dates every record in the ledger's zone, whichever book is picked", () => {
    const { open } = renderDialog({ scope: BOOK_B });
    open();

    fireEvent.change(screen.getByTestId("book-select"), { target: { value: BOOK_A } });

    expect(formsAttrs()).toMatchObject({
      bookId: BOOK_A,
      viewedBookId: BOOK_B,
      timeZone: "Europe/Berlin",
    });
  });

  it("opens on the last saved book when it is still live", () => {
    writeLastNewRecordBookId(BOOK_B);
    const { open } = renderDialog({});
    open();

    expect(formsAttrs()).toMatchObject({ bookId: BOOK_B, savedBook: `${BOOK_B}:Travel` });
  });

  it("falls back to the first book when the remembered book is gone", () => {
    writeLastNewRecordBookId("10000000-0000-4000-8000-00000000dead");
    const { open } = renderDialog({});
    open();

    expect(formsAttrs().bookId).toBe(BOOK_A);
  });

  it("keeps the pick when the books refetch while the dialog stays open", () => {
    const { rerender, open } = renderDialog({ scope: BOOK_A });
    open();
    fireEvent.change(screen.getByTestId("book-select"), { target: { value: BOOK_B } });

    rerender(true, { books: [createBook({ name: "Household" }), defaultBooks[1]!] });

    expect(formsAttrs()).toMatchObject({ bookId: BOOK_B, savedBook: `${BOOK_B}:Travel` });
  });

  it("resets to the remembered pick every time the dialog opens", () => {
    writeLastNewRecordBookId(BOOK_B);
    const { rerender, open } = renderDialog({});
    open();
    fireEvent.change(screen.getByTestId("book-select"), { target: { value: BOOK_A } });
    expect(formsAttrs().bookId).toBe(BOOK_A);

    rerender(false);
    open();

    expect(formsAttrs().bookId).toBe(BOOK_B);
  });

  it("resolves to the first book when the pick is not (yet) live", () => {
    const { rerender, open } = renderDialog({ books: [] });
    open();

    rerender(true, { books: defaultBooks });

    expect(formsAttrs()).toMatchObject({ bookId: BOOK_A, savedBook: `${BOOK_A}:Daily` });
  });
});

describe("NewRecordSheet state", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is named 记账 without a visible title", () => {
    const { open } = renderDialog();
    open();

    expect(screen.getByRole("dialog", { name: "记账" })).toBeInTheDocument();
    expect(screen.getByText("记账")).toHaveClass("sr-only");
  });

  it("cannot be closed while the form is submitting", () => {
    const { open } = renderDialog();
    open();
    expect(screen.getByRole("button", { name: commonCopy.close })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "start submit" }));

    expect(screen.queryByRole("button", { name: commonCopy.close })).toBeNull();
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    expect(screen.getByTestId("record-forms")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "settle submit" }));
    fireEvent.click(screen.getByRole("button", { name: commonCopy.close }));

    expect(screen.queryByTestId("record-forms")).toBeNull();
  });

  it("closes when the form saves", () => {
    const { open } = renderDialog();
    open();

    fireEvent.click(screen.getByRole("button", { name: "saved" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("record-forms")).toBeNull();
  });
});
