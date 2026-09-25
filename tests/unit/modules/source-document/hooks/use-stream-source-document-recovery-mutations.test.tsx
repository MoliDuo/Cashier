import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { actions, awaitInvalidation, mutationObservers } = vi.hoisted(() => ({
  actions: {
    retry: vi.fn(),
    cancel: vi.fn(),
  },
  awaitInvalidation: vi.fn<() => Promise<void>>(),
  mutationObservers: vi.fn(),
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/modules/source-document/server-actions/retry", () => ({
  retrySourceDocumentAction: actions.retry,
}));
vi.mock("@/modules/source-document/server-actions/processing", () => ({
  cancelSourceDocumentProcessingAction: actions.cancel,
}));
vi.mock("@/lib/mutations/use-ledger-mutation", () => ({
  useLedgerMutation: (options: Record<string, unknown>) => {
    mutationObservers();
    return {
      mutateAsync: async (variables: unknown) => {
        const data = await (options.mutationFn as (value: unknown) => Promise<unknown>)(variables);
        await awaitInvalidation();
        return data;
      },
    };
  },
}));

import { useStreamSourceDocumentRecoveryMutations } from "@/modules/source-document/hooks/useStreamSourceDocumentRecoveryMutations";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useStreamSourceDocumentRecoveryMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    awaitInvalidation.mockResolvedValue();
  });

  it.each([
    ["retry", "retryingIds", actions.retry],
    ["cancelProcessing", "cancellingIds", actions.cancel],
  ] as const)(
    "keeps %s locked until cache invalidation completes",
    async (method, pendingKey, action) => {
      const command = deferred<unknown>();
      const invalidation = deferred<void>();
      action.mockReturnValue(command.promise);
      awaitInvalidation.mockReturnValue(invalidation.promise);
      const { result } = renderHook(() => useStreamSourceDocumentRecoveryMutations());
      const initialAction = result.current[method];

      expect(mutationObservers).toHaveBeenCalledTimes(2);
      act(() => {
        void result.current[method]({ sourceDocumentId: "doc-1" });
        void result.current[method]({ sourceDocumentId: "doc-1" });
      });
      expect(action).toHaveBeenCalledTimes(1);
      expect(result.current[pendingKey].has("doc-1")).toBe(true);
      expect(result.current[method]).toBe(initialAction);

      command.resolve({});
      await waitFor(() => expect(awaitInvalidation).toHaveBeenCalledTimes(1));
      expect(result.current[pendingKey].has("doc-1")).toBe(true);

      act(() => {
        void result.current[method]({ sourceDocumentId: "doc-1" });
      });
      expect(action).toHaveBeenCalledTimes(1);

      invalidation.resolve();
      await waitFor(() => expect(result.current[pendingKey].has("doc-1")).toBe(false));
      expect(result.current[method]).toBe(initialAction);
    }
  );
});
