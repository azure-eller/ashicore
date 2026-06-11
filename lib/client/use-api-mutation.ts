"use client";

import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

type QueryKey = readonly unknown[];
type InvalidateRefetchType = "active" | "inactive" | "all" | "none";

/**
 * useMutation with the repo-standard success step: the `invalidates` query
 * keys are invalidated before the caller's onSuccess runs. Everything else
 * passes through unchanged. Use plain useMutation only when success handling
 * genuinely differs (optimistic updates, sequencing).
 */
export function useApiMutation<
  TData = unknown,
  TVariables = void,
  TContext = unknown,
>({
  invalidates,
  invalidateRefetchType,
  onSuccess,
  ...options
}: UseMutationOptions<TData, Error, TVariables, TContext> & {
  invalidates: readonly QueryKey[];
  invalidateRefetchType?: InvalidateRefetchType;
}) {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVariables, TContext>({
    ...options,
    onSuccess: async (data, variables, context, mutation) => {
      await Promise.all(
        invalidates.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey, refetchType: invalidateRefetchType }),
        ),
      );
      await onSuccess?.(data, variables, context, mutation);
    },
  });
}
