import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSourceDocumentInputDraft } from "@/modules/source-document/hooks/useSourceDocumentInputDraft";
import { formatDateTimeForApi, parseDateString } from "@/lib/date-utils";

describe("useSourceDocumentInputDraft", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("compares a retry draft with its complete initial seed", () => {
    const initialData = {
      text: "Prefilled receipt",
      images: [
        {
          data: "data:image/png;base64,AQ==",
          mimeType: "image/png",
          storedFileId: "file-1",
        },
      ],
      entryDate: "2026-08-19",
    };
    const { result } = renderHook(() => useSourceDocumentInputDraft({ initialData }));

    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setText("Changed receipt"));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.setText(initialData.text));
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.removeImage(0));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.setImages(() => initialData.images.map((image) => ({ ...image }))));
    expect(result.current.isDirty).toBe(false);
  });

  it("releases object URLs on removal, reset, replacement, and unmount", () => {
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const image = (data: string) => ({
      data,
      mimeType: "image/jpeg",
      file: new File([data], `${data}.jpg`, { type: "image/jpeg" }),
      objectUrl: true as const,
    });
    const { result, unmount } = renderHook(() => useSourceDocumentInputDraft({}));

    act(() => result.current.setImages([image("blob:remove"), image("blob:reset")]));
    act(() => result.current.removeImage(0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:remove");

    act(() => result.current.resetDraft());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:reset");

    act(() => result.current.setImages([image("blob:replace")]));
    act(() => result.current.setImages([image("blob:unmount")]));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:replace");

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:unmount");
    expect(revokeObjectURL).toHaveBeenCalledTimes(4);
  });

  it("does not reinitialize a mounted draft when a refreshed seed arrives", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useSourceDocumentInputDraft({ initialData: { text } }),
      { initialProps: { text: "Original" } }
    );
    act(() => result.current.setText("Unsaved"));
    rerender({ text: "Refreshed" });
    expect(result.current.text).toBe("Unsaved");
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.setText("Original"));
    expect(result.current.isDirty).toBe(false);
  });

  describe("book zone changes", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-27T16:30:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("recomputes an untouched default date from the newly picked book zone", () => {
      const systemTime = new Date("2026-07-27T16:30:00.000Z");
      const { result, rerender } = renderHook(
        ({ timeZone }: { timeZone: string | undefined }) =>
          useSourceDocumentInputDraft({
            ...(timeZone != null ? { timeZone } : {}),
          }),
        { initialProps: { timeZone: undefined as string | undefined } }
      );

      // Without a book zone the device clock decides.
      expect(result.current.entryDate.getTime()).toBe(systemTime.getTime());
      expect(result.current.isDirty).toBe(false);

      rerender({ timeZone: "Asia/Shanghai" });
      expect(formatDateTimeForApi(result.current.entryDate)).toBe("2026-07-28");
      // Moving an untouched default is not a user edit.
      expect(result.current.isDirty).toBe(false);

      act(() => result.current.setEntryDate(parseDateString("2026-07-20")));
      expect(result.current.isDirty).toBe(true);
      rerender({ timeZone: "America/Los_Angeles" });
      expect(formatDateTimeForApi(result.current.entryDate)).toBe("2026-07-20");
      expect(result.current.isDirty).toBe(true);
    });

    it("keeps the document date of a retry seed when the zone changes", () => {
      const { result, rerender } = renderHook(
        ({ timeZone }: { timeZone: string }) =>
          useSourceDocumentInputDraft({
            initialData: { entryDate: "2026-08-19" },
            timeZone,
          }),
        { initialProps: { timeZone: "UTC" } }
      );

      expect(result.current.entryDate).toEqual(new Date(2026, 7, 19));
      rerender({ timeZone: "Asia/Shanghai" });
      expect(result.current.entryDate).toEqual(new Date(2026, 7, 19));
    });

    it("accepts a new default again after a successful save resets the draft", () => {
      const { result, rerender } = renderHook(
        ({ timeZone }: { timeZone: string }) => useSourceDocumentInputDraft({ timeZone }),
        { initialProps: { timeZone: "UTC" } }
      );
      act(() => result.current.setEntryDate(parseDateString("2026-07-20")));
      expect(result.current.isDirty).toBe(true);

      act(() => result.current.resetDraft());
      expect(result.current.isDirty).toBe(false);
      expect(formatDateTimeForApi(result.current.entryDate)).toBe("2026-07-27");

      rerender({ timeZone: "Asia/Shanghai" });
      expect(formatDateTimeForApi(result.current.entryDate)).toBe("2026-07-28");
      expect(result.current.isDirty).toBe(false);
    });
  });
});
