import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createSourceDocumentActionMock,
  retrySourceDocumentActionMock,
  toastErrorMock,
  toastSuccessMock,
  uploadSubmissionImagesMock,
} = vi.hoisted(() => ({
  createSourceDocumentActionMock: vi.fn(),
  retrySourceDocumentActionMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  uploadSubmissionImagesMock: vi.fn(),
}));

vi.mock("@/modules/source-document/server-actions/create", () => ({
  createSourceDocumentAction: createSourceDocumentActionMock,
}));
vi.mock("@/modules/source-document/server-actions/retry", () => ({
  editRetrySourceDocumentAction: retrySourceDocumentActionMock,
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

vi.mock(
  "@/modules/source-document/hooks/source-document-submission-upload",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/modules/source-document/hooks/source-document-submission-upload")
    >()),
    uploadSourceDocumentSubmissionImages: uploadSubmissionImagesMock,
  })
);

import type { SourceDocumentInputControllerMessages } from "@/modules/source-document/hooks/source-document-input-controller.types";
import { useSourceDocumentSubmitMutations } from "@/modules/source-document/hooks/useSourceDocumentSubmitMutations";
import { SourceDocumentInput } from "@/modules/source-document/ui/SourceDocumentInput";

vi.mock("@/modules/source-document/ui/SourceDocumentInputView", () => ({
  SourceDocumentInputView: ({
    text,
    onTextChange,
    onSubmit,
  }: {
    text: string;
    onTextChange: (text: string) => void;
    onSubmit: () => void;
  }) => (
    <>
      <input
        aria-label="draft"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
      />
      <button onClick={onSubmit}>submit</button>
    </>
  ),
}));

const messages: SourceDocumentInputControllerMessages = {
  retrySuccess: "retried",
  retryError: "retry failed",
  imageTooLarge: (fileName) => `large: ${fileName}`,
  imageUnsupported: (fileName) => `unsupported: ${fileName}`,
  imageReadError: "read failed",
  imageUploadError: "upload failed",
  networkError: "network failed",
  validationError: "validation failed",
  createError: "create failed",
  tooManyImages: "too many images",
};

function setup(onSuccess: () => void) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useSourceDocumentSubmitMutations({
        mode: "create",
        messages,
        onSuccess,
      }),
    { wrapper }
  );
}

describe("useSourceDocumentSubmitMutations", () => {
  beforeEach(() => {
    createSourceDocumentActionMock.mockReset();
    retrySourceDocumentActionMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    uploadSubmissionImagesMock.mockReset();
    uploadSubmissionImagesMock.mockImplementation(async (payload: unknown) => payload);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs the success callback only after submission completes", async () => {
    let resolveSubmission!: (result: {
      sourceDocumentId: string;
      revisionId: string;
      revisionState: "processing";
    }) => void;
    const pendingSubmission = new Promise<{
      sourceDocumentId: string;
      revisionId: string;
      revisionState: "processing";
    }>((resolve) => {
      resolveSubmission = resolve;
    });
    createSourceDocumentActionMock.mockReturnValue(pendingSubmission);
    const onSuccess = vi.fn();
    const { result } = setup(onSuccess);

    act(() => {
      result.current.submit({ documentDate: "2026-07-17", text: "Lunch", storedFileIds: [] });
    });
    await waitFor(() => expect(createSourceDocumentActionMock).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () =>
      resolveSubmission({
        sourceDocumentId: "source-1",
        revisionId: "revision-1",
        revisionState: "processing",
      })
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith({
      sourceDocumentId: "source-1",
      documentDate: "2026-07-17",
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("keeps the form open and reports a submission failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    createSourceDocumentActionMock.mockRejectedValue(new Error("server unavailable"));
    const onSuccess = vi.fn();
    const { result } = setup(onSuccess);

    act(() => {
      result.current.submit({ documentDate: "2026-07-17", text: "Lunch", storedFileIds: [] });
    });

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("create failed"));
    expect(onSuccess).not.toHaveBeenCalled();

    const firstClientSubmissionId = createSourceDocumentActionMock.mock.calls[0]?.[1];
    act(() => {
      result.current.submit({ documentDate: "2026-07-17", text: "Lunch", storedFileIds: [] });
    });
    await waitFor(() => expect(createSourceDocumentActionMock).toHaveBeenCalledTimes(2));
    expect(createSourceDocumentActionMock.mock.calls[1]?.[1]).toBe(firstClientSubmissionId);
  });

  it("reuses uploaded files and submission identity after an ambiguous failure", async () => {
    uploadSubmissionImagesMock.mockResolvedValue({
      documentDate: "2026-07-17",
      text: "Lunch",
      storedFileIds: ["stored-1"],
    });
    createSourceDocumentActionMock
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ sourceDocumentId: "source-1", version: 1, status: "processing" });
    const { result } = setup(vi.fn());
    const imageFile = new File([new Uint8Array([1])], "receipt.png", { type: "image/png" });
    const payload = {
      documentDate: "2026-07-17",
      storedFileIds: [],
      text: "Lunch",
      images: [{ file: imageFile, mimeType: "image/png" }],
    };

    act(() =>
      result.current.submit({
        ...payload,
        images: payload.images.map((image) => ({ ...image })),
      })
    );
    await waitFor(() => expect(createSourceDocumentActionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    const firstSubmissionId = createSourceDocumentActionMock.mock.calls[0]?.[1];

    act(() => result.current.submit(payload));
    await waitFor(() => expect(createSourceDocumentActionMock).toHaveBeenCalledTimes(2));

    expect(uploadSubmissionImagesMock).toHaveBeenCalledTimes(1);
    expect(createSourceDocumentActionMock.mock.calls[1]?.[0]).toEqual({
      documentDate: "2026-07-17",
      text: "Lunch",
      storedFileIds: ["stored-1"],
    });
    expect(createSourceDocumentActionMock.mock.calls[1]?.[1]).toBe(firstSubmissionId);
  });

  it("uses a new submission identity when the payload changes", async () => {
    createSourceDocumentActionMock.mockRejectedValue(new Error("server unavailable"));
    const { result } = setup(vi.fn());

    act(() =>
      result.current.submit({ documentDate: "2026-07-17", text: "Lunch", storedFileIds: [] })
    );
    await waitFor(() => expect(createSourceDocumentActionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    const firstSubmissionId = createSourceDocumentActionMock.mock.calls[0]?.[1];

    act(() =>
      result.current.submit({ documentDate: "2026-07-17", text: "Dinner", storedFileIds: [] })
    );
    await waitFor(() => expect(createSourceDocumentActionMock).toHaveBeenCalledTimes(2));

    expect(createSourceDocumentActionMock.mock.calls[1]?.[1]).not.toBe(firstSubmissionId);
  });

  it("cancels before the deferred mutation starts", async () => {
    let startMutation: FrameRequestCallback | undefined;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        startMutation = callback;
        return 1;
      })
    );
    const onSuccess = vi.fn();
    const { result } = setup(onSuccess);

    act(() => {
      result.current.submit({ documentDate: "2026-07-17", text: "Lunch", storedFileIds: [] });
    });
    expect(result.current.canCancel).toBe(true);

    act(() => result.current.cancel());
    expect(result.current.progress?.phase).toBe("cancelling");
    expect(result.current.canCancel).toBe(false);

    act(() => startMutation?.(0));
    await waitFor(() => expect(result.current.progress).toBeNull());
    expect(createSourceDocumentActionMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("forwards the retry draft version to the action and keeps stale drafts intact", async () => {
    retrySourceDocumentActionMock.mockResolvedValue({
      ok: false,
      sourceDocumentId: "source-1",
      expectedVersion: 7,
      currentVersion: 8,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onSuccess = vi.fn();
    const form = (version: number, id = "source-1") => (
      <QueryClientProvider client={queryClient}>
        <SourceDocumentInput
          mode="retry"
          sourceDocumentId={id}
          sourceDocumentVersion={version}
          initialData={{ text: "Original", entryDate: "2026-07-17" }}
          onSuccess={onSuccess}
        />
      </QueryClientProvider>
    );
    const view = render(form(7));
    fireEvent.change(screen.getByRole("textbox", { name: "draft" }), {
      target: { value: "Unsaved" },
    });
    view.rerender(form(8));
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() =>
      expect(retrySourceDocumentActionMock).toHaveBeenCalledWith(
        "source-1",
        expect.objectContaining({ text: "Unsaved" }),
        7
      )
    );
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "draft" })).toHaveValue("Unsaved");
    view.rerender(form(2, "source-2"));
    expect(screen.getByRole("textbox", { name: "draft" })).toHaveValue("Original");
  });
});
