import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServiceCredentialSection } from "@/modules/ledger/ui/ServiceCredentialSection";
import { commonCopy } from "@/copy/common";
import { serviceCredentialsCopy } from "@/copy/settings";
import type { CreatedServiceCredentialDto, ServiceCredentialDto } from "@/modules/ledger/contracts";

const books = [
  {
    id: "book-1",
    ledgerId: "ledger-1",
    name: "Shared",
    timeZone: null,
    sortOrder: 1,
    archivedAt: null,
  },
  {
    id: "book-2",
    ledgerId: "ledger-1",
    name: "Mine",
    timeZone: null,
    sortOrder: 2,
    archivedAt: null,
  },
];

const credentialFixture = (
  overrides: Pick<ServiceCredentialDto, "id" | "bookId">
): ServiceCredentialDto => ({
  ledgerId: "ledger-1",
  name: "Automation",
  tokenPrefix: "sec",
  tokenSuffix: "ret",
  createdAt: "2026-08-07T00:00:00.000Z",
  lastUsedAt: null,
  deletedAt: null,
  ...overrides,
});

describe("ServiceCredentialSection", () => {
  it("keeps the create dialog locked until the credential is authoritative", async () => {
    let resolveCreate!: (value: CreatedServiceCredentialDto) => void;
    const onCreateCredential = vi.fn(
      () =>
        new Promise<CreatedServiceCredentialDto>((resolve) => {
          resolveCreate = resolve;
        })
    );
    render(
      <ServiceCredentialSection
        credentials={[]}
        books={books}
        onCreateCredential={onCreateCredential}
        onSetCredentialBook={vi.fn(async () => undefined)}
        onDeleteCredential={vi.fn(async () => undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: serviceCredentialsCopy.newCredential }));
    fireEvent.change(screen.getByPlaceholderText(serviceCredentialsCopy.namePlaceholder), {
      target: { value: "Automation" },
    });
    fireEvent.click(screen.getByRole("button", { name: commonCopy.confirm }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: commonCopy.cancel })).toBeDisabled()
    );
    expect(screen.getByPlaceholderText(serviceCredentialsCopy.namePlaceholder)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: commonCopy.confirm }));
    expect(onCreateCredential).toHaveBeenCalledTimes(1);

    resolveCreate({
      id: "credential-1",
      bookId: "book-1",
      ledgerId: "ledger-1",
      name: "Automation",
      token: "secret",
      tokenPrefix: "sec",
      tokenSuffix: "ret",
      createdAt: "2026-08-07T00:00:00.000Z",
      lastUsedAt: null,
      deletedAt: null,
    });
    await waitFor(() =>
      expect(screen.getByText(serviceCredentialsCopy.createSuccessTitle)).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: commonCopy.close })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByText(serviceCredentialsCopy.createSuccessTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: serviceCredentialsCopy.saved }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("awaits deletion and prevents the confirmation from closing early", async () => {
    let resolveDelete!: () => void;
    const onDeleteCredential = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );
    render(
      <ServiceCredentialSection
        credentials={[
          {
            id: "credential-1",
            bookId: "book-1",
            ledgerId: "ledger-1",
            name: "Automation",
            tokenPrefix: "sec",
            tokenSuffix: "ret",
            createdAt: "2026-08-07T00:00:00.000Z",
            lastUsedAt: null,
            deletedAt: null,
          },
        ]}
        books={books}
        onCreateCredential={vi.fn()}
        onSetCredentialBook={vi.fn(async () => undefined)}
        onDeleteCredential={onDeleteCredential}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: serviceCredentialsCopy.deleteButton({ name: "Automation" }),
      })
    );
    expect(
      screen.getByText(serviceCredentialsCopy.deleteDesc({ name: "Automation" }))
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: commonCopy.delete }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: commonCopy.delete })).toBeDisabled()
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onDeleteCredential).toHaveBeenCalledTimes(1);

    resolveDelete();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("formats credential dates as a full Chinese date", () => {
    const formatted = "2026年8月7日 星期五";
    const createdAt = "2026-08-07T00:00:00.000Z";
    render(
      <ServiceCredentialSection
        credentials={[
          {
            id: "credential-1",
            bookId: "book-1",
            ledgerId: "ledger-1",
            name: "Automation",
            tokenPrefix: "sec",
            tokenSuffix: "ret",
            createdAt,
            lastUsedAt: null,
            deletedAt: null,
          },
        ]}
        books={books}
        onCreateCredential={vi.fn()}

        onSetCredentialBook={vi.fn(async () => undefined)}

        onDeleteCredential={vi.fn()}
      />
    );

    expect(
      screen.getByText(serviceCredentialsCopy.createdAt({ date: formatted }))
    ).toBeInTheDocument();
  });

  it("names a key's book and lets it change", async () => {
    const onSetCredentialBook = vi.fn(async () => undefined);
    render(
      <ServiceCredentialSection
        credentials={[
          credentialFixture({ id: "shared", bookId: "book-1" }),
          credentialFixture({ id: "mine", bookId: "book-2" }),
        ]}
        books={books}
        onCreateCredential={vi.fn()}
        onSetCredentialBook={onSetCredentialBook}
        onDeleteCredential={vi.fn()}
      />
    );

    // Each picker prints the book it writes to, so the row states it once.
    const pickers = screen.getAllByRole("combobox");
    expect(pickers[0]).toHaveTextContent("Shared");
    expect(pickers[1]).toHaveTextContent("Mine");

    fireEvent.click(pickers[0]!);
    // "Mine" is both the open trigger's current value and an option, so the
    // option is picked by its listbox role instead of by text.
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText("Mine"));
    await waitFor(() => expect(onSetCredentialBook).toHaveBeenCalledWith("shared", "book-2"));
  });

  it("starts the create dialog from the default book every time it opens", async () => {
    render(
      <ServiceCredentialSection
        credentials={[]}
        books={books}
        onCreateCredential={vi.fn()}
        onSetCredentialBook={vi.fn(async () => undefined)}
        onDeleteCredential={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: serviceCredentialsCopy.newCredential }));
    expect(screen.getByRole("combobox")).toHaveTextContent("Shared");

    fireEvent.click(screen.getByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText("Mine"));
    expect(screen.getByRole("combobox")).toHaveTextContent("Mine");

    fireEvent.click(screen.getByRole("button", { name: commonCopy.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: serviceCredentialsCopy.newCredential }));
    expect(screen.getByRole("combobox")).toHaveTextContent("Shared");
  });

  it("labels a key whose book is archived or unresolvable", async () => {
    render(
      <ServiceCredentialSection
        credentials={[credentialFixture({ id: "orphan", bookId: "book-archived" })]}
        books={books}
        onCreateCredential={vi.fn()}
        onSetCredentialBook={vi.fn(async () => undefined)}
        onDeleteCredential={vi.fn()}
      />
    );

    // The picker names the archived book rather than going blank, and still
    // offers somewhere to move the key.
    expect(screen.getByRole("combobox")).toHaveTextContent(serviceCredentialsCopy.archivedBook);

    fireEvent.click(screen.getByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("Shared")).toBeInTheDocument();
  });
});
