"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

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
  invalidateQueryKeys: QueryKey[];
  onDeleted: () => void;
  onMutate?: () => void;
  onError?: (error: Error) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey,
    mutationFn,
    onMutate,
    onError,
    onSuccess: async () => {
      await Promise.all(
        invalidateQueryKeys.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      onDeleted();
    },
  });
}
