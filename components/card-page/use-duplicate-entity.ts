"use client";

import { useApiMutation } from "@/lib/client/use-api-mutation";

type QueryKey = readonly unknown[];

export function useDuplicateEntity({
  mutationKey,
  mutationFn,
  invalidateQueryKeys,
  onDuplicated,
  onMutate,
  onError,
}: {
  mutationKey: QueryKey;
  mutationFn: () => Promise<{ id: string }>;
  invalidateQueryKeys: readonly QueryKey[];
  onDuplicated: (created: { id: string }) => void;
  onMutate?: () => void;
  onError?: (error: Error) => void;
}) {
  return useApiMutation({
    mutationKey,
    mutationFn,
    invalidates: invalidateQueryKeys,
    onMutate,
    onError,
    onSuccess: (created: { id: string }) => {
      onDuplicated(created);
    },
  });
}
