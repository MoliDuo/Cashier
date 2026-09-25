import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

const { deleteSourceDocumentActionMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  deleteSourceDocumentActionMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));
vi.mock("@/modules/source-document/server-actions/delete", () => ({
  deleteSourceDocumentAction: deleteSourceDocumentActionMock,
}));

import { useSourceDocumentRecordMutations } from "@/modules/source-document/hooks/useSourceDocumentRecordMutations";

describe("useSourceDocumentRecordMutations", () => {
  it("keeps the detail open when delete fails", async () => {
    deleteSourceDocumentActionMock.mockRejectedValue(new Error("Source document not found"));
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const onClose = vi.fn();
    const { result } = renderHook(
      () =>
        useSourceDocumentRecordMutations({
          id: "document-1",
          onClose,
        }),
      { wrapper }
    );

    await expect(result.current.deleteDocumentMutation.mutateAsync()).rejects.toThrow(
      "Source document not found"
    );
    expect(deleteSourceDocumentActionMock).toHaveBeenCalledWith("document-1");
    expect(onClose).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("deleteFailed");
  });
});
