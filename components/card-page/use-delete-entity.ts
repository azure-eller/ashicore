"use client";

import { useApiMutation } from "@/lib/client/use-api-mutation";

type QueryKey = readonly unknown[];

export function useDeleteEntity({
  mutationKey,
  mutationFn,
  invalidateQueryKeys,
  onDeleted,
  onMutate,
  onError,
}: {
  mutationKey: QueryKey;
  mutationFn: () => Promise<unknown>;
  invalidateQueryKeys: readonly QueryKey[];
  onDeleted: () => void;
  onMutate?: () => void;
  onError?: (error: Error) => void;
}) {
  return useApiMutation({
    mutationKey,
    mutationFn,
    invalidates: invalidateQueryKeys,
    invalidateRefetchType: "inactive",
    onMutate,
    onError,
    onSuccess: () => {
      onDeleted();
    },
  });
}
