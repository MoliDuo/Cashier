import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";

const {
  saveEntryCategoriesMock,
  createLedgerEntryWithConversionMock,
  createServiceCredentialMock,
  deleteServiceCredentialMock,
} = vi.hoisted(() => ({
  saveEntryCategoriesMock: vi.fn(),
  createLedgerEntryWithConversionMock: vi.fn(),
  createServiceCredentialMock: vi.fn(),
  deleteServiceCredentialMock: vi.fn(),
}));

vi.mock("@/lib/auth-actions", () => ({
  withAuth:
    <TArgs extends unknown[], TResult>(handler: (userId: string, ...args: TArgs) => TResult) =>
    (...args: TArgs) =>
      handler("user-1", ...args),
}));

vi.mock("@/modules/ledger/access", () => ({
  withLedgerAccess: <TArgs extends unknown[], TResult>(
    handler: (ledgerId: string, ...args: TArgs) => TResult
  ) => handler,
  withLedgerAccessContext:
    <TArgs extends unknown[], TResult>(
      handler: (access: { userId: string }, ledgerId: string, ...args: TArgs) => TResult
    ) =>
    (ledgerId: string, ...args: TArgs) =>
      handler({ userId: "00000000-0000-4000-8000-000000000001" }, ledgerId, ...args),
}));

vi.mock("@/application/adapters/postgres/ledger-entry-idempotency", () => ({
  postgresIdempotentLedgerEntryCommandAdapter: {
    create: vi.fn((input) =>
      createLedgerEntryWithConversionMock({ ledgerId: input.ledgerId, ...input.command })
    ),
    update: vi.fn(),
    delete: vi.fn(),
  },
  runIdempotentUserMutation: vi.fn((_input, mutation) => mutation()),
}));

vi.mock("@/modules/ledger/application/use-cases/save-entry-categories", () => ({
  saveEntryCategories: saveEntryCategoriesMock,
}));
vi.mock("@/modules/ledger/application/use-cases/create-service-credential", () => ({
  createServiceCredential: createServiceCredentialMock,
}));
vi.mock("@/modules/ledger/application/use-cases/delete-service-credential", () => ({
  deleteServiceCredential: deleteServiceCredentialMock,
}));

vi.mock("@/modules/ledger/application/queries/list-entry-categories", () => ({
  listEntryCategories: vi.fn(),
}));
vi.mock("@/modules/ledger/application/queries/list-ledger-entries", () => ({
  listLedgerEntries: vi.fn(),
}));
vi.mock("@/modules/ledger/application/queries/list-service-credentials", () => ({
  listServiceCredentials: vi.fn(),
}));

import { saveEntryCategoriesAction } from "@/modules/ledger/server-actions/categories";
import { createLedgerEntryAction } from "@/modules/ledger/server-actions/entries";
import {
  createServiceCredentialAction,
  deleteServiceCredentialAction,
} from "@/modules/ledger/server-actions/credentials";

describe("ledger server-action validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveEntryCategoriesMock.mockResolvedValue({ id: "category-1" });
    createLedgerEntryWithConversionMock.mockResolvedValue({ id: "entry-1" });
    createServiceCredentialMock.mockResolvedValue({ id: "credential-1" });
    deleteServiceCredentialMock.mockResolvedValue(undefined);
  });

  it("saveEntryCategoriesAction rejects invalid payload with ValidationError", async () => {
    await expect(
      saveEntryCategoriesAction("ledger-1", {
        expectedRevision: "invalid",
        categories: [],
      } as never)
    ).rejects.toBeInstanceOf(ValidationError);
    expect(saveEntryCategoriesMock).not.toHaveBeenCalled();
  });

  it("createLedgerEntryAction rejects invalid sourceDocumentId with ValidationError", async () => {
    await expect(
      createLedgerEntryAction(
        "ledger-1",
        {
          sourceDocumentId: "bad-id",
          expectedVersion: 1,
        } as never,
        {
          amount: 1,
          itemName: "x",
          sourceDocumentId: "bad-id",
        } as never
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(createLedgerEntryWithConversionMock).not.toHaveBeenCalled();
  });

  it("createServiceCredentialAction rejects blank name with ValidationError", async () => {
    await expect(
      createServiceCredentialAction("ledger-1", {
        expectedRevision: "invalid",
        categories: [],
      } as never)
    ).rejects.toBeInstanceOf(ValidationError);
    expect(createServiceCredentialMock).not.toHaveBeenCalled();
  });

  it("deleteServiceCredentialAction rejects invalid credential id with ValidationError", async () => {
    await expect(deleteServiceCredentialAction("ledger-1", "bad-id")).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(deleteServiceCredentialMock).not.toHaveBeenCalled();
  });
});
