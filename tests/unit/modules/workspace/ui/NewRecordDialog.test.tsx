import { act, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ledgerPageCopy } from "@/copy/app";
import { commonCopy } from "@/copy/common";
import type { BookDto } from "@/modules/ledger/contracts";
import { writeLastNewRecordBookId } from "@/modules/workspace/new-record-book-memory";
import { WorkspaceStoreProvider, useWorkspaceStore } from "@/modules/workspace/store";

vi.mock("@/modules/workspace/ui/NewRecordForms", () => ({
  InputFormLoadingFallback: () => null,
  NewRecordForms: (props: {
    bookId: string;
    viewedBookId: string | null;
    savedBook: { id: string; name: string } | null;
    timeZone?: string;
    inputMode: string;
    setInputMode: (mode: "ai" | "quick") => void;
    setAiPending: (pending: boolean) => void;
    setInputOpen: (open: boolean) => void;
  }) => (
    <div
      data-testid="record-forms"
      data-book-id={props.bookId}
      data-viewed-book-id={props.viewedBookId ?? ""}
      data-saved-book={
        props.savedBook == null ? "" : `${props.savedBook.id}:${props.savedBook.name}`
      }
      data-time-zone={props.timeZone ?? ""}
      data-input-mode={props.inputMode}
    >
      <button type="button" onClick={() => props.setAiPending(true)}>
        start submit
      </button>
      <button type="button" onClick={() => props.setAiPending(false)}>
        settle submit
      </button>
      <button type="button" onClick={() => props.setInputOpen(false)}>
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

type DialogProps = Parameters<typeof NewRecordDialog>[0];

/** Stands in for the shell's + button, which opens the dialog through the store. */
function OpenFlag({ open }: { open: boolean }) {
  const setOpen = useWorkspaceStore((state) => state.setNewRecordOpen);
  useLayoutEffect(() => setOpen(open), [open, setOpen]);
  return null;
}

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const props: DialogProps = {
    scope: null,
    books: defaultBooks,
    activeTab: "stream",
    committedFilters: {},
    categories: [],
    mainCurrency: "CNY",
    preferredCurrencies: [],
    deviceTimeZone: "Europe/Berlin",
    ...overrides,
  };
  const tree = (isOpen: boolean, extra: Partial<DialogProps> = {}) => (
    <WorkspaceStoreProvider initialBookId={null}>
      <OpenFlag open={isOpen} />
      <NewRecordDialog {...props} {...extra} />
    </WorkspaceStoreProvider>
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

    expect(formsAttrs()).toMatchObject({
      bookId: BOOK_A,
      savedBook: `${BOOK_A}:Daily`,
      timeZone: "Asia/Shanghai",
    });
  });
});

describe("NewRecordDialog state", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("opens on AI parsing and switches to quick entry", () => {
    const { open } = renderDialog();
    open();
    expect(screen.getByTestId("record-forms")).toHaveAttribute("data-input-mode", "ai");

    fireEvent.click(screen.getByRole("button", { name: ledgerPageCopy.quickEntry }));

    expect(screen.getByTestId("record-forms")).toHaveAttribute("data-input-mode", "quick");
  });

  it("cannot be closed or switched while a form is submitting", () => {
    const { open } = renderDialog();
    open();
    expect(screen.getByRole("button", { name: commonCopy.close })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "start submit" }));

    expect(screen.queryByRole("button", { name: commonCopy.close })).toBeNull();
    expect(screen.getByRole("button", { name: ledgerPageCopy.quickEntry })).toBeDisabled();
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    expect(screen.getByTestId("record-forms")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "settle submit" }));
    fireEvent.click(screen.getByRole("button", { name: commonCopy.close }));

    expect(screen.queryByTestId("record-forms")).toBeNull();
  });

  it("closes when a form saves", () => {
    const { open } = renderDialog();
    open();

    fireEvent.click(screen.getByRole("button", { name: "saved" }));

    expect(screen.queryByTestId("record-forms")).toBeNull();
  });
});
