import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSourceDocumentDetailMutations } from "@/modules/source-document/hooks/useSourceDocumentDetailMutations";
import { queryKeys } from "@/lib/query-keys";

const { saveMock, splitMock, createEntryMock, deleteEntryMock } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  splitMock: vi.fn(),
  createEntryMock: vi.fn(),
  deleteEntryMock: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/modules/ledger/server-actions/entries", () => ({
  createLedgerEntryAction: createEntryMock,
  deleteLedgerEntryAction: deleteEntryMock,
  batchUpdateLedgerEntriesAction: vi.fn(),
  batchDeleteLedgerEntriesAction: vi.fn(),
}));
vi.mock("@/modules/source-document/server-actions/update", () => ({
  saveSourceDocumentChangesAction: saveMock,
}));
vi.mock("@/modules/source-document/server-actions/split", () => ({
  splitSourceDocumentAction: splitMock,
}));
vi.mock("@/modules/source-document/hooks/useSourceDocumentRecordMutations", () => ({
  useSourceDocumentRecordMutations: () => ({ deleteDocumentMutation: { mutateAsync: vi.fn() } }),
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe("useSourceDocumentDetailMutations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends canonical entry patches with the snapshot version", async () => {
    const { client, wrapper } = setup();
    vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    saveMock.mockResolvedValue({
      ok: true,
      sourceDocumentId: "source-1",
      version: 8,
      data: { updatedEntryIds: [] },
    });
    const { result } = renderHook(
      () =>
        useSourceDocumentDetailMutations({
          id: "source-1",
          onClose: vi.fn(),
        }),
      { wrapper }
    );
    await act(async () => {
      await result.current.saveChanges({
        expectedVersion: 7,
        changes: {
          sourceDoc: { title: "Updated" },
          entries: { "entry-2": { itemName: "Second" }, "entry-1": { itemName: "First" } },
        },
      });
    });
    expect(saveMock).toHaveBeenCalledWith({
      sourceDocumentId: "source-1",
      expectedVersion: 7,
      sourceDocument: { title: "Updated" },
      entries: [
        { ledgerEntryId: "entry-1", data: { itemName: "First" } },
        { ledgerEntryId: "entry-2", data: { itemName: "Second" } },
      ],
    });
  });

  it("passes only split business input", async () => {
    const { client, wrapper } = setup();
    vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    splitMock.mockResolvedValue({
      splitSourceDocumentId: "source-2",
      splitVersion: 1,
      movedEntryCount: 1,
      sourceDocument: { id: "source-1", version: 8, ledgerEntries: [] },
    });
    const { result } = renderHook(
      () =>
        useSourceDocumentDetailMutations({
          id: "source-1",
          onClose: vi.fn(),
        }),
      { wrapper }
    );
    await act(async () => {
      await result.current.splitEntries({
        ledgerEntryIds: ["entry-1"],
        entryDate: "2026-08-16",
      });
    });
    expect(splitMock).toHaveBeenCalledWith({
      sourceDocumentId: "source-1",
      ledgerEntryIds: ["entry-1"],
      entryDate: "2026-08-16",
    });
    await expect(
      result.current.splitEntries({
        ledgerEntryIds: ["entry-1"],
        entryDate: "2026-08-16",
      })
    ).resolves.toEqual({
      sourceDocument: { id: "source-1", version: 8, ledgerEntries: [] },
      splitSourceDocumentId: "source-2",
      splitVersion: 1,
      movedEntryCount: 1,
    });
  });

  it("installs each committed snapshot and permits another split before list refresh finishes", async () => {
    const { client, wrapper } = setup();
    let finishRefresh!: () => void;
    vi.spyOn(client, "invalidateQueries").mockReturnValue(
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      })
    );
    let committedVersion = 7;
    splitMock.mockImplementation(async () => ({
      splitSourceDocumentId: "source-2",
      splitVersion: 1,
      movedEntryCount: 1,
      sourceDocument: {
        id: "source-1",
        version: ++committedVersion,
        ledgerEntries: [{ id: "remaining" }],
      },
    }));
    const { result } = renderHook(
      () =>
        useSourceDocumentDetailMutations({
          id: "source-1",
          onClose: vi.fn(),
        }),
      { wrapper }
    );
    const key = queryKeys.sourceDocument("source-1");
    for (const version of [7, 8]) {
      await act(async () => {
        await result.current.splitEntries({
          ledgerEntryIds: ["entry-1"],
          entryDate: "2026-08-16",
        });
      });
      expect(client.getQueryData(key)).toMatchObject({
        version: version + 1,
        ledgerEntries: [{ id: "remaining" }],
      });
    }
    expect(splitMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      finishRefresh();
    });
  });

  it("rejects a stale save result", async () => {
    const { wrapper } = setup();
    saveMock.mockResolvedValue({
      ok: false,
      reason: "stale",
      sourceDocumentId: "source-1",
      expectedVersion: 7,
      currentVersion: 8,
    });
    const { result } = renderHook(
      () =>
        useSourceDocumentDetailMutations({
          id: "source-1",
          onClose: vi.fn(),
        }),
      { wrapper }
    );

    await expect(
      result.current.saveChanges({
        expectedVersion: 7,
        changes: { sourceDoc: { title: "Updated" }, entries: {} },
      })
    ).rejects.toMatchObject({
      code: "SOURCE_DOCUMENT_STALE",
    });
  });

  it("sends entry commands with only the document id", async () => {
    const { client, wrapper } = setup();
    vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    createEntryMock.mockResolvedValue({ ledgerEntryId: "entry-2" });
    deleteEntryMock.mockResolvedValue({ ledgerEntryId: "entry-1", deleted: true });
    const { result } = renderHook(
      () =>
        useSourceDocumentDetailMutations({
          id: "source-1",
          onClose: vi.fn(),
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.addEntry({ itemName: "Lunch", amount: 12 });
      await result.current.deleteEntry("entry-1");
    });

    expect(createEntryMock).toHaveBeenCalledWith({
      sourceDocumentId: "source-1",
      itemName: "Lunch",
      amount: "12",
    });
    expect(deleteEntryMock).toHaveBeenCalledWith("source-1", "entry-1");
  });
});
