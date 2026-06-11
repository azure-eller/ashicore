"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { cardSaveMutationKey } from "./card-save-status";

type QueryKey = readonly unknown[];

export function useEntityFieldCommit<TPatch, TResult>({
  entityKey,
  entityId,
  scope,
  mutationFn,
  setQueryDataKey,
  optimisticUpdate,
  invalidateQueryKeys,
}: {
  entityKey: string;
  entityId: string;
  scope: string;
  mutationFn: (patch: TPatch) => Promise<TResult>;
  setQueryDataKey?: QueryKey;
  optimisticUpdate?: (
    current: TResult | undefined,
    patch: TPatch,
  ) => TResult | undefined;
  invalidateQueryKeys?: readonly QueryKey[];
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: cardSaveMutationKey(entityKey, entityId, "header", scope),
    mutationFn,
    onMutate: async (patch) => {
      if (!setQueryDataKey || !optimisticUpdate) return undefined;
      await queryClient.cancelQueries({ queryKey: setQueryDataKey });
      const previous = queryClient.getQueryData<TResult>(setQueryDataKey);
      const next = optimisticUpdate(previous, patch);
      if (next !== undefined) {
        queryClient.setQueryData(setQueryDataKey, next);
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (!setQueryDataKey || !context) return;
      queryClient.setQueryData(setQueryDataKey, context.previous);
    },
    onSuccess: (result) => {
      if (setQueryDataKey) {
        queryClient.setQueryData(setQueryDataKey, result);
      }
    },
    onSettled: () => {
      for (const queryKey of invalidateQueryKeys ?? []) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  return (patch: TPatch) => mutation.mutate(patch);
}
