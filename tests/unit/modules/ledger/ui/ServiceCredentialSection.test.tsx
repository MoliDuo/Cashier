import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceCredentialSection } from "@/modules/ledger/ui/ServiceCredentialSection";
import type { CreatedServiceCredentialDto, ServiceCredentialDto } from "@/modules/ledger/contracts";

const intl = vi.hoisted(() => ({ locale: "en" }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.date != null
      ? `${key}:${String(values.date)}`
      : values?.name != null
        ? `${key}:${String(values.name)}`
        : values?.book != null
          ? `${key}:${String(values.book)}`
          : key,
  useLocale: () => intl.locale,
}));

const books = [
  {
    id: "book-1",
    ledgerId: "ledger-1",
    name: "Shared",
    timeZone: null,
    sortOrder: 1,
    isDefault: true,
  },
  {
    id: "book-2",
    ledgerId: "ledger-1",
    name: "Mine",
    timeZone: null,
    sortOrder: 2,
    isDefault: false,
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
  beforeEach(() => {
    intl.locale = "en";
  });

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

    fireEvent.click(screen.getByRole("button", { name: "newCredential" }));
    fireEvent.change(screen.getByPlaceholderText("namePlaceholder"), {
      target: { value: "Automation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "cancel" })).toBeDisabled());
    expect(screen.getByPlaceholderText("namePlaceholder")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));
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
    await waitFor(() => expect(screen.getByText("createSuccessTitle")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "close" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByText("createSuccessTitle")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "saved" }));
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

    fireEvent.click(screen.getByRole("button", { name: "deleteButton:Automation" }));
    expect(screen.getByText("deleteDesc:Automation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "delete" })).toBeDisabled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onDeleteCredential).toHaveBeenCalledTimes(1);

    resolveDelete();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each([
    ["en", "Friday, August 7, 2026"],
    ["zh", "2026年8月7日 星期五"],
  ] as const)("formats credential dates with the %s locale", (locale, formatted) => {
    intl.locale = locale;
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

    expect(screen.getByText(`createdAt:${formatted}`)).toBeInTheDocument();
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

    expect(screen.getByText("book:Shared")).toBeInTheDocument();
    expect(screen.getByText("book:Mine")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("combobox")[0]!);
    // "Mine" is both the open trigger's current value and an option, so the
    // option is picked by its listbox role instead of by text.
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText("Mine"));
    await waitFor(() => expect(onSetCredentialBook).toHaveBeenCalledWith("shared", "book-2"));
  });
});
