import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query-keys";
import type { CreatedServiceCredentialDto } from "@/modules/ledger/contracts";
import { useCredentialMutations } from "@/modules/ledger/hooks/useCredentialMutations";

const { createServiceCredentialAction, deleteServiceCredentialAction } = vi.hoisted(() => ({
  createServiceCredentialAction: vi.fn(),
  deleteServiceCredentialAction: vi.fn(),
}));

vi.mock("@/modules/ledger/server-actions/credentials", () => ({
  createServiceCredentialAction,
  deleteServiceCredentialAction,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function createWrapper(queryClient: QueryClient) {
  function TestQueryClientProvider({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return TestQueryClientProvider;
}

const createdCredential: CreatedServiceCredentialDto = {
  bookId: "user-1",
  id: "credential-1",
  ledgerId: "ledger-1",
  name: "CLI",
  tokenPrefix: "cashier_",
  tokenSuffix: "abcd",
  token: "cashier_secret_token",
  createdAt: "2026-08-06T00:00:00.000Z",
  lastUsedAt: null,
  deletedAt: null,
};

describe("useCredentialMutations", () => {
  it("keeps the one-time token out of the settings query cache", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.ledgerSettings("ledger-1"), {
      uncategorizedCount: 0,
      credentials: [],
    });
    createServiceCredentialAction.mockResolvedValueOnce(createdCredential);

    const { result } = renderHook(() => useCredentialMutations("ledger-1"), {
      wrapper: createWrapper(queryClient),
    });

    let returned: CreatedServiceCredentialDto | undefined;
    await act(async () => {
      returned = await result.current.createCredential.mutateAsync({
        name: "CLI",
        bookId: "book-1",
      });
    });

    expect(returned?.token).toBe(createdCredential.token);
    const cached = queryClient.getQueryData<{
      credentials: Array<Record<string, unknown>>;
    }>(queryKeys.ledgerSettings("ledger-1"));
    expect(cached?.credentials).toEqual([]);
    expect(JSON.stringify(cached)).not.toContain(createdCredential.token);
  });

  it("clears mutation data when the one-time result is dismissed", async () => {
    const queryClient = new QueryClient();
    createServiceCredentialAction.mockResolvedValueOnce(createdCredential);

    const { result } = renderHook(() => useCredentialMutations("ledger-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.createCredential.mutateAsync({ name: "CLI", bookId: "book-1" });
    });
    await waitFor(() =>
      expect(result.current.createCredential.data?.token).toBe(createdCredential.token)
    );

    act(() => result.current.createCredential.reset());

    await waitFor(() => expect(result.current.createCredential.data).toBeUndefined());
  });
});
