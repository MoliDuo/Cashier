import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBatchDatePreview } from "@/modules/workspace/hooks/useBatchDatePreview";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("useBatchDatePreview", () => {
  it("shows the preview once it arrives", async () => {
    const answer = deferred<number>();
    const { result } = renderHook(() => useBatchDatePreview(() => answer.promise));

    act(() => result.current.start());
    expect(result.current.isPreviewing).toBe(true);
    await act(async () => answer.resolve(3));

    expect(result.current).toMatchObject({ impact: 3, isPreviewing: false, failed: false });
  });

  it("says so when the preview fails, and can ask again", async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useBatchDatePreview(() =>
        ++calls === 1 ? Promise.reject(new Error("x")) : Promise.resolve(5)
      )
    );

    act(() => result.current.start());
    await waitFor(() => expect(result.current.failed).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.impact).toBe(5));
  });

  it("drops an answer that arrives after the dialog closed", async () => {
    const answer = deferred<number>();
    const { result } = renderHook(() => useBatchDatePreview(() => answer.promise));

    act(() => result.current.start());
    act(() => result.current.close());
    await act(async () => answer.resolve(7));

    expect(result.current).toMatchObject({ impact: null, isPreviewing: false });
  });

  it("keeps only the latest of two overlapping previews", async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const answers = [first, second];
    const { result } = renderHook(() => useBatchDatePreview(() => answers.shift()!.promise));

    act(() => result.current.start());
    act(() => result.current.start());
    await act(async () => second.resolve(2));
    await act(async () => first.resolve(1));

    expect(result.current.impact).toBe(2);
  });
});
