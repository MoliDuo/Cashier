import { StrictMode } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceDocumentInputCopy } from "@/copy/source-document";
import { formatDateTimeForApi, parseDateString } from "@/lib/date-utils";
import { clearAllDrafts } from "@/lib/drafts";
import type { SourceDocumentInputProps } from "@/modules/source-document/ui/source-document-input.types";

const {
  trackMock,
  createSourceDocumentActionMock,
  loadFilesMock,
  retrySourceDocumentActionMock,
  toastErrorMock,
  toastSuccessMock,
  uploadSubmissionImagesMock,
} = vi.hoisted(() => ({
  trackMock: vi.fn(),
  createSourceDocumentActionMock: vi.fn(),
  loadFilesMock: vi.fn(),
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
vi.mock("@/lib/telemetry/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telemetry/client")>()),
  track: trackMock,
}));
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));
vi.mock("@/modules/source-document/hooks/source-document-input-images", () => ({
  loadSourceDocumentInputFiles: loadFilesMock,
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

import { useSourceDocumentInput } from "@/modules/source-document/hooks/useSourceDocumentInput";
import { SourceDocumentInput } from "@/modules/source-document/ui/SourceDocumentInput";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
}

function renderInput(
  initialProps: SourceDocumentInputProps = {},
  { strict = false }: { strict?: boolean } = {}
) {
  const onSuccess = vi.fn();
  const onPendingChange = vi.fn();
  const onDirtyChange = vi.fn();
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => {
    const tree = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  const view = renderHook(
    (props: SourceDocumentInputProps) =>
      useSourceDocumentInput({ onSuccess, onPendingChange, onDirtyChange, ...props }),
    { initialProps, wrapper }
  );
  const isDirty = () => (onDirtyChange.mock.lastCall?.[0] as boolean | undefined) ?? false;
  return { ...view, onSuccess, onPendingChange, isDirty };
}

function imageFile(name = "receipt.png") {
  return new File([new Uint8Array([1])], name, { type: "image/png" });
}

function objectUrlImage(data: string) {
  return {
    kind: "ready",
    image: {
      data,
      mimeType: "image/jpeg",
      file: new File([data], `${data}.jpg`, { type: "image/jpeg" }),
      objectUrl: true,
    },
  };
}

describe("useSourceDocumentInput", () => {
  beforeEach(() => {
    trackMock.mockReset();
    createSourceDocumentActionMock.mockReset();
    retrySourceDocumentActionMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    loadFilesMock.mockReset();
    uploadSubmissionImagesMock.mockReset();
    uploadSubmissionImagesMock.mockImplementation(async (payload: unknown) => payload);
    // Drafts outlive a hook in the page's memory, so each test starts without one.
    clearAllDrafts();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("images", () => {
    it("keeps accepting asynchronously loaded images under Strict Mode", async () => {
      loadFilesMock.mockResolvedValue([
        { kind: "ready", image: { data: "data:image/png;base64,AQ==", mimeType: "image/png" } },
      ]);
      const { result } = renderInput({}, { strict: true });
      const input = document.createElement("input");
      Object.defineProperty(input, "files", { value: [imageFile()] });

      act(() => {
        result.current.handleFileInputChange({ target: input } as ChangeEvent<HTMLInputElement>);
      });

      await waitFor(() => expect(result.current.images).toHaveLength(1));
      expect(result.current.isPreparingImages).toBe(false);
      expect(result.current.canSubmit).toBe(true);
    });

    it("snapshots selected files before resetting an iOS-style live file list", async () => {
      loadFilesMock.mockResolvedValue([]);
      const { result } = renderInput();
      const selectedFile = new File([new Uint8Array([1])], "camera.jpg", { type: "image/jpeg" });
      let selectedFiles: File[] = [selectedFile];
      const input = {
        get files() {
          return selectedFiles;
        },
        set value(value: string) {
          if (value === "") selectedFiles = [];
        },
      };

      act(() => {
        result.current.handleFileInputChange({
          target: input,
        } as unknown as ChangeEvent<HTMLInputElement>);
      });

      await waitFor(() =>
        expect(loadFilesMock).toHaveBeenCalledWith([selectedFile], expect.anything())
      );
      expect(selectedFiles).toEqual([]);
    });

    it("names an image it could not read", async () => {
      loadFilesMock.mockResolvedValue([{ kind: "unsupported", fileName: "scan.heic" }]);
      const { result } = renderInput();

      act(() => result.current.addImageFiles([imageFile("scan.heic")]));

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          sourceDocumentInputCopy.imageUnsupported({ fileName: "scan.heic" })
        )
      );
      expect(result.current.images).toHaveLength(0);
    });

    it("releases object URLs on removal, reset, replacement, and discarding a kept draft", async () => {
      const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
      createSourceDocumentActionMock.mockResolvedValue({ sourceDocumentId: "source-1" });
      const { result, unmount } = renderInput();
      const add = async (...data: string[]) => {
        loadFilesMock.mockResolvedValueOnce(data.map(objectUrlImage));
        const before = result.current.images.length;
        act(() => result.current.addImageFiles(data.map(() => imageFile())));
        await waitFor(() => expect(result.current.images).toHaveLength(before + data.length));
      };

      await add("blob:remove", "blob:reset");
      act(() => result.current.removeImage(0));
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:remove");

      act(() => result.current.handleSubmit());
      await waitFor(() => expect(result.current.images).toHaveLength(0));
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:reset");

      await add("blob:replace");
      act(() => result.current.discardDraft());
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:replace");

      // Closing keeps an unsaved draft's images for the next opening; discarding
      // it there lets them go.
      await add("blob:kept");
      unmount();
      expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:kept");
      const reopened = renderInput();
      expect(reopened.result.current.images).toHaveLength(1);
      act(() => reopened.result.current.discardDraft());
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:kept");
      expect(revokeObjectURL).toHaveBeenCalledTimes(4);
    });
  });

  describe("draft", () => {
    it("keeps typed text and picked images across a close, and only the text across a reload", async () => {
      loadFilesMock.mockResolvedValue([
        { kind: "ready", image: { data: "data:image/png;base64,AQ==", mimeType: "image/png" } },
      ]);
      const first = renderInput();
      act(() => first.result.current.setText("午饭 35"));
      act(() => first.result.current.addImageFiles([imageFile()]));
      await waitFor(() => expect(first.result.current.images).toHaveLength(1));
      first.unmount();

      const reopened = renderInput();
      expect(reopened.result.current.text).toBe("午饭 35");
      expect(reopened.result.current.images).toHaveLength(1);
      expect(reopened.result.current.restoredFromDraft).toBe(true);
      reopened.unmount();

      // A reload loses the page's memory; the stored text is still there.
      const drafts = await import("@/lib/drafts");
      drafts.takeDraftFromMemory(drafts.draftKey("new-record-ai", "new"));
      const reloaded = renderInput();
      expect(reloaded.result.current.text).toBe("午饭 35");
      expect(reloaded.result.current.images).toHaveLength(0);

      act(() => reloaded.result.current.discardDraft());
      expect(reloaded.result.current.text).toBe("");
      expect(window.localStorage.length).toBe(0);
    });

    it("compares a retry draft with its complete initial seed", () => {
      const initialData = {
        text: "Prefilled receipt",
        images: [
          { data: "data:image/png;base64,AQ==", mimeType: "image/png", storedFileId: "file-1" },
        ],
        entryDate: "2026-08-19",
      };
      const { result, isDirty } = renderInput({
        mode: "retry",
        sourceDocumentId: "source-1",
        initialData,
      });

      expect(isDirty()).toBe(false);

      act(() => result.current.setText("Changed receipt"));
      expect(isDirty()).toBe(true);

      act(() => result.current.setText(initialData.text));
      expect(isDirty()).toBe(false);

      act(() => result.current.removeImage(0));
      expect(isDirty()).toBe(true);

      // Fresh copies of the seed images compare equal by value.
      act(() => result.current.discardDraft());
      expect(result.current.images).toHaveLength(1);
      expect(isDirty()).toBe(false);
    });

    it("gives a draft kept past midnight today's default, but keeps a hand-picked date", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-07-27T15:00:00.000Z"));
        const evening = renderInput({ timeZone: "Asia/Shanghai" });
        act(() => evening.result.current.setText("夜宵 20"));
        expect(formatDateTimeForApi(evening.result.current.entryDate)).toBe("2026-07-27");
        evening.unmount();

        vi.setSystemTime(new Date("2026-07-27T23:30:00.000Z"));
        const morning = renderInput({ timeZone: "Asia/Shanghai" });
        expect(morning.result.current.text).toBe("夜宵 20");
        expect(formatDateTimeForApi(morning.result.current.entryDate)).toBe("2026-07-28");
        act(() => morning.result.current.setEntryDate(parseDateString("2026-07-20")));
        morning.unmount();

        const later = renderInput({ timeZone: "Asia/Shanghai" });
        expect(formatDateTimeForApi(later.result.current.entryDate)).toBe("2026-07-20");
        later.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not reinitialize a mounted draft when a refreshed seed arrives", () => {
      const { result, rerender, isDirty } = renderInput({ initialData: { text: "Original" } });
      act(() => result.current.setText("Unsaved"));
      rerender({ initialData: { text: "Refreshed" } });
      expect(result.current.text).toBe("Unsaved");
      expect(isDirty()).toBe(true);
      act(() => result.current.setText("Original"));
      expect(isDirty()).toBe(false);
    });
  });

  describe("book zone changes", () => {
    const systemTime = new Date("2026-07-27T16:30:00.000Z");

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(systemTime);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("recomputes an untouched default date from the newly picked book zone", () => {
      const { result, rerender, isDirty } = renderInput({});

      // Without a book zone the device clock decides.
      expect(result.current.entryDate.getTime()).toBe(systemTime.getTime());
      expect(isDirty()).toBe(false);

      rerender({ timeZone: "Asia/Shanghai" });
      expect(formatDateTimeForApi(result.current.entryDate)).toBe("2026-07-28");
      // Moving an untouched default is not a user edit.
      expect(isDirty()).toBe(false);

      act(() => result.current.setEntryDate(parseDateString("2026-07-20")));
      expect(isDirty()).toBe(true);
      rerender({ timeZone: "America/Los_Angeles" });
      expect(formatDateTimeForApi(result.current.entryDate)).toBe("2026-07-20");
      expect(isDirty()).toBe(true);
    });

    it("keeps the document date of a retry seed when the zone changes", () => {
      const seed = {
        mode: "retry" as const,
        sourceDocumentId: "source-1",
        initialData: { entryDate: "2026-08-19" },
      };
      const { result, rerender } = renderInput({ ...seed, timeZone: "UTC" });

      expect(result.current.entryDate).toEqual(new Date(2026, 7, 19));
      rerender({ ...seed, timeZone: "Asia/Shanghai" });
      expect(result.current.entryDate).toEqual(new Date(2026, 7, 19));
    });

    it("accepts a new default again after a successful save resets the draft", async () => {
      createSourceDocumentActionMock.mockResolvedValue({ sourceDocumentId: "source-1" });
      const { result, rerender, isDirty, onSuccess } = renderInput({ timeZone: "UTC" });
      act(() => result.current.setText("Lunch"));
      act(() => result.current.setEntryDate(parseDateString("2026-07-20")));
      expect(isDirty()).toBe(true);

      act(() => result.current.handleSubmit());
      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(isDirty()).toBe(false);
      expect(formatDateTimeForApi(result.current.entryDate)).toBe("2026-07-27");

      rerender({ timeZone: "Asia/Shanghai" });
      expect(formatDateTimeForApi(result.current.entryDate)).toBe("2026-07-28");
      expect(isDirty()).toBe(false);
    });
  });

  describe("submit", () => {
    it("runs the success callback only after submission completes", async () => {
      let resolveSubmission!: (result: { sourceDocumentId: string }) => void;
      createSourceDocumentActionMock.mockReturnValue(
        new Promise((resolve) => {
          resolveSubmission = resolve;
        })
      );
      const { result, onSuccess, onPendingChange } = renderInput({ timeZone: "UTC" });
      act(() => result.current.setText("Lunch"));

      act(() => result.current.handleSubmit());
      await waitFor(() => expect(createSourceDocumentActionMock).toHaveBeenCalledTimes(1));
      expect(onPendingChange).toHaveBeenLastCalledWith(true);
      expect(onSuccess).not.toHaveBeenCalled();

      await act(async () => resolveSubmission({ sourceDocumentId: "source-1" }));
      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(onSuccess).toHaveBeenCalledWith({
        sourceDocumentId: "source-1",
        documentDate: formatDateTimeForApi(result.current.entryDate),
      });
      expect(result.current.text).toBe("");
      await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(false));
      expect(toastSuccessMock).not.toHaveBeenCalled();
    });

    it("keeps the form open and reports a submission failure", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      createSourceDocumentActionMock.mockRejectedValue(new Error("server unavailable"));
      const { result, onSuccess } = renderInput();
      act(() => result.current.setText("Lunch"));

      act(() => result.current.handleSubmit());

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(sourceDocumentInputCopy.createError)
      );
      expect(onSuccess).not.toHaveBeenCalled();
      expect(result.current.text).toBe("Lunch");
      await waitFor(() => expect(result.current.isSubmitting).toBe(false));

      const firstClientSubmissionId = createSourceDocumentActionMock.mock.calls[0]?.[1];
      act(() => result.current.handleSubmit());
      await waitFor(() => expect(createSourceDocumentActionMock).toHaveBeenCalledTimes(2));
      expect(createSourceDocumentActionMock.mock.calls[1]?.[1]).toBe(firstClientSubmissionId);
    });

    it("reuses uploaded files and submission identity after an ambiguous failure", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      loadFilesMock.mockResolvedValue([
        {
          kind: "ready",
          image: { data: "data:image/png;base64,AQ==", mimeType: "image/png", file: imageFile() },
        },
      ]);
      uploadSubmissionImagesMock.mockResolvedValue({
        documentDate: "2026-07-17",
        text: "Lunch",
        storedFileIds: ["stored-1"],
      });
      createSourceDocumentActionMock
        .mockRejectedValueOnce(new Error("response lost"))
        .mockResolvedValueOnce({ sourceDocumentId: "source-1", version: 1, status: "processing" });
      const { result } = renderInput();
      act(() => result.current.setText("Lunch"));
      act(() => result.current.addImageFiles([imageFile()]));
      await waitFor(() => expect(result.current.canSubmit).toBe(true));

      act(() => result.current.handleSubmit());
      await waitFor(() => expect(createSourceDocumentActionMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.isSubmitting).toBe(false));
      const firstSubmissionId = createSourceDocumentActionMock.mock.calls[0]?.[1];

      act(() => result.current.handleSubmit());
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
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      createSourceDocumentActionMock.mockRejectedValue(new Error("server unavailable"));
      const { result } = renderInput();
      act(() => result.current.setText("Lunch"));

      act(() => result.current.handleSubmit());
      await waitFor(() => expect(createSourceDocumentActionMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.isSubmitting).toBe(false));
      const firstSubmissionId = createSourceDocumentActionMock.mock.calls[0]?.[1];

      act(() => result.current.setText("Dinner"));
      act(() => result.current.handleSubmit());
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
      const { result, onSuccess } = renderInput();
      act(() => result.current.setText("Lunch"));

      act(() => result.current.handleSubmit());
      expect(result.current.canCancelUpload).toBe(true);

      act(() => result.current.cancelUpload());
      expect(result.current.progress?.phase).toBe("cancelling");
      expect(result.current.canCancelUpload).toBe(false);

      act(() => startMutation?.(0));
      await waitFor(() => expect(result.current.progress).toBeNull());
      expect(createSourceDocumentActionMock).not.toHaveBeenCalled();
      expect(toastErrorMock).not.toHaveBeenCalled();
      expect(toastSuccessMock).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("announces a submitted retry", async () => {
      retrySourceDocumentActionMock.mockResolvedValue({ sourceDocumentId: "source-1" });
      const { result, onSuccess } = renderInput({
        mode: "retry",
        sourceDocumentId: "source-1",
        initialData: { text: "Original", entryDate: "2026-07-17" },
      });

      act(() => result.current.handleSubmit());

      await waitFor(() =>
        expect(toastSuccessMock).toHaveBeenCalledWith(sourceDocumentInputCopy.retrySuccess)
      );
      expect(retrySourceDocumentActionMock).toHaveBeenCalledWith(
        "source-1",
        expect.objectContaining({ text: "Original", documentDate: "2026-07-17" }),
        expect.any(String)
      );
      expect(onSuccess).toHaveBeenCalledWith({
        sourceDocumentId: "source-1",
        documentDate: "2026-07-17",
      });
    });
  });
});

describe("useSourceDocumentInput telemetry", () => {
  beforeEach(() => {
    trackMock.mockReset();
    createSourceDocumentActionMock.mockReset();
    retrySourceDocumentActionMock.mockReset();
    uploadSubmissionImagesMock.mockReset();
    uploadSubmissionImagesMock.mockImplementation(async (payload: unknown) => payload);
    clearAllDrafts();
    window.localStorage.clear();
  });

  const events = (name: string) =>
    trackMock.mock.calls.filter(([event]) => event === name).map(([, props]) => props);

  it("records open, first input, submit and result with one correlation id, and no abandon", async () => {
    createSourceDocumentActionMock.mockResolvedValue({ sourceDocumentId: "source-1" });
    const { result, unmount } = renderInput({ timeZone: "UTC" });
    expect(events("record.open")).toEqual([{ mode: "create", restored: false }]);

    act(() => result.current.setText("secret lunch note"));
    act(() => result.current.setText("secret lunch note 2"));
    expect(events("record.input")).toEqual([{ mode: "create", kind: "text" }]);

    act(() => result.current.handleSubmit());
    await waitFor(() => expect(createSourceDocumentActionMock).toHaveBeenCalledTimes(1));
    const clientSubmissionId = createSourceDocumentActionMock.mock.calls[0]?.[1];
    expect(events("record.submit")).toEqual([
      {
        mode: "create",
        correlationId: clientSubmissionId,
        imageCount: 0,
        chars: "secret lunch note 2".length,
        dateEdited: false,
      },
    ]);
    await waitFor(() => expect(events("record.result")).toHaveLength(1));
    expect(events("record.result")[0]).toMatchObject({
      mode: "create",
      correlationId: clientSubmissionId,
      ok: true,
    });

    unmount();
    expect(events("record.abandon")).toEqual([]);
    // Types, counts and ids only: nothing the user typed.
    expect(JSON.stringify(trackMock.mock.calls)).not.toContain("secret");
  });

  it("records a failed submit with an error code, then the abandon when the form closes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    createSourceDocumentActionMock.mockRejectedValue(new Error("boom: secret detail"));
    const { result, unmount } = renderInput({ timeZone: "UTC" });
    act(() => result.current.setText("Lunch"));
    act(() => result.current.handleSubmit());
    await waitFor(() => expect(events("record.result")).toHaveLength(1));
    expect(events("record.result")[0]).toMatchObject({ ok: false, errorKind: "createError" });

    unmount();
    expect(events("record.abandon")).toEqual([
      expect.objectContaining({
        mode: "create",
        hadInput: true,
        submitting: false,
        imageCount: 0,
        chars: 5,
      }),
    ]);
    expect(JSON.stringify(trackMock.mock.calls)).not.toContain("secret");
  });

  it("records an abandon for a form closed untouched", () => {
    const { unmount } = renderInput({ timeZone: "UTC" });
    unmount();
    expect(events("record.abandon")).toEqual([
      expect.objectContaining({ hadInput: false, submitting: false, chars: 0 }),
    ]);
  });

  it("sends a retry's correlation id to the action as well as to record.submit", async () => {
    retrySourceDocumentActionMock.mockResolvedValue({ status: "processing" });
    const { result } = renderInput({
      mode: "retry",
      sourceDocumentId: "source-1",
      initialData: { text: "Original", entryDate: "2026-07-17" },
    });
    act(() => result.current.handleSubmit());
    await waitFor(() => expect(retrySourceDocumentActionMock).toHaveBeenCalledTimes(1));
    const [submit] = events("record.submit") as Array<{ correlationId: string }>;
    expect(submit?.correlationId).toEqual(expect.any(String));
    expect(retrySourceDocumentActionMock.mock.calls[0]?.[2]).toBe(submit?.correlationId);
  });

  it("records a restored draft and its discard", () => {
    const first = renderInput({ timeZone: "UTC" });
    act(() => first.result.current.setText("kept"));
    first.unmount();
    trackMock.mockClear();

    const second = renderInput({ timeZone: "UTC" });
    expect(events("record.open")).toEqual([{ mode: "create", restored: true }]);
    expect(events("record.draft")).toEqual([{ mode: "create", action: "restore" }]);
    act(() => second.result.current.discardDraft());
    expect(events("record.draft")).toContainEqual({ mode: "create", action: "discard" });
  });
});

describe("SourceDocumentInput", () => {
  beforeEach(() => {
    retrySourceDocumentActionMock.mockReset();
    toastErrorMock.mockReset();
    uploadSubmissionImagesMock.mockReset();
    uploadSubmissionImagesMock.mockImplementation(async (payload: unknown) => payload);
  });

  it("forwards the retry draft to the action and keeps failed drafts intact", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    retrySourceDocumentActionMock.mockRejectedValue(new Error("Source document is processing"));
    const queryClient = createQueryClient();
    const onSuccess = vi.fn();
    const form = (id = "source-1") => (
      <QueryClientProvider client={queryClient}>
        <SourceDocumentInput
          mode="retry"
          sourceDocumentId={id}
          initialData={{ text: "Original", entryDate: "2026-07-17" }}
          onSuccess={onSuccess}
        />
      </QueryClientProvider>
    );
    const view = render(form());
    fireEvent.change(screen.getByRole("textbox", { name: "draft" }), {
      target: { value: "Unsaved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() =>
      expect(retrySourceDocumentActionMock).toHaveBeenCalledWith(
        "source-1",
        expect.objectContaining({ text: "Unsaved" }),
        expect.any(String)
      )
    );
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(sourceDocumentInputCopy.retryError)
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "draft" })).toHaveValue("Unsaved");
    view.rerender(form("source-2"));
    expect(screen.getByRole("textbox", { name: "draft" })).toHaveValue("Original");
  });
});
