import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  invalidateLedgerQueries,
  type LedgerInvalidationGroup,
} from "@/lib/mutations/ledger-invalidation";

export interface UseLedgerMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  refreshMode?: "wait" | "background";
  /** In background mode, only this detail view must be ready before the next edit. */
  refreshQueryKey?: readonly unknown[];
  invalidates:
    | readonly LedgerInvalidationGroup[]
    | ((data: TData, variables: TVariables) => readonly LedgerInvalidationGroup[]);
  successMessage?: string | null;
  errorMessage?: string | null;
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  onError?: (error: Error, variables: TVariables) => void;
  onSettled?: (
    data: TData | undefined,
    error: Error | null,
    variables: TVariables | undefined
  ) => void | Promise<void>;
}

export function useLedgerMutation<TData = unknown, TVariables = void>(
  ledgerId: string | null | undefined,
  options: UseLedgerMutationOptions<TData, TVariables>
) {
  const queryClient = useQueryClient();
  const tCommon = useTranslations("Common");
  const {
    mutationFn,
    refreshMode = "wait",
    refreshQueryKey,
    invalidates,
    successMessage,
    errorMessage,
    onSuccess,
    onError,
    onSettled,
  } = options;

  return useMutation<TData, Error, TVariables>({
    mutationFn,
    onSuccess: async (data, variables) => {
      try {
        await onSuccess?.(data, variables);
      } catch (error) {
        console.error("[useLedgerMutation] success callback failed", { error });
      }

      if (successMessage != null) toast.success(successMessage);

      if (ledgerId != null && ledgerId !== "") {
        const groups =
          typeof invalidates === "function" ? invalidates(data, variables) : invalidates;
        const refresh = async () => {
          try {
            await invalidateLedgerQueries(queryClient, ledgerId, groups);
          } catch (invalidationError) {
            console.error("[useLedgerMutation] resource invalidation failed", {
              error: invalidationError,
            });
            toast.error(tCommon("savedRefreshFailed"));
            globalThis.setTimeout(() => {
              void invalidateLedgerQueries(queryClient, ledgerId, groups).catch((retryError) => {
                console.error("[useLedgerMutation] resource invalidation retry failed", {
                  error: retryError,
                });
              });
            }, 1_000);
          }
        };
        if (refreshMode === "background") {
          void refresh();
          if (refreshQueryKey != null) {
            await queryClient.refetchQueries(
              { queryKey: refreshQueryKey, exact: true, type: "active" },
              { cancelRefetch: false }
            );
          }
        } else {
          await refresh();
        }
      }
    },
    onError: (error, variables) => {
      if (errorMessage != null) toast.error(errorMessage);
      onError?.(error, variables);
    },
    ...(onSettled === undefined ? {} : { onSettled }),
  });
}
