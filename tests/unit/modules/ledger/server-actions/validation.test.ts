import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";

const { saveEntryCategoriesMock, createServiceCredentialMock, deleteServiceCredentialMock } =
  vi.hoisted(() => ({
    saveEntryCategoriesMock: vi.fn(),
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
  withLedgerAccess:
    <TArgs extends unknown[], TResult>(handler: (ledgerId: string, ...args: TArgs) => TResult) =>
    (...args: TArgs) =>
      handler("ledger-1", ...args),
}));

vi.mock("@/modules/ledger/server/categories", () => ({
  saveEntryCategories: saveEntryCategoriesMock,
  applyCategoryPreset: vi.fn(),
}));
vi.mock("@/modules/ledger/server/service-credentials", () => ({
  createServiceCredential: createServiceCredentialMock,
  revokeServiceCredential: deleteServiceCredentialMock,
  setServiceCredentialBook: vi.fn(),
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
    createServiceCredentialMock.mockResolvedValue({ id: "credential-1" });
    deleteServiceCredentialMock.mockResolvedValue(undefined);
  });

  it("saveEntryCategoriesAction rejects invalid payload with ValidationError", async () => {
    await expect(
      saveEntryCategoriesAction({
        expectedRevision: "invalid",
        categories: [],
      } as never)
    ).rejects.toBeInstanceOf(ValidationError);
    expect(saveEntryCategoriesMock).not.toHaveBeenCalled();
  });

  it("createLedgerEntryAction rejects invalid sourceDocumentId with ValidationError", async () => {
    await expect(
      createLedgerEntryAction({
        amount: 1,
        itemName: "x",
        sourceDocumentId: "bad-id",
      } as never)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("createServiceCredentialAction rejects blank name with ValidationError", async () => {
    await expect(
      createServiceCredentialAction({
        expectedRevision: "invalid",
        categories: [],
      } as never)
    ).rejects.toBeInstanceOf(ValidationError);
    expect(createServiceCredentialMock).not.toHaveBeenCalled();
  });

  it("deleteServiceCredentialAction rejects invalid credential id with ValidationError", async () => {
    await expect(deleteServiceCredentialAction("bad-id")).rejects.toBeInstanceOf(ValidationError);
    expect(deleteServiceCredentialMock).not.toHaveBeenCalled();
  });
});
