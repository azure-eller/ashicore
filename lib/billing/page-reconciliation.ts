export async function reconcileBillingPageState<T>({
  current,
  reconcile,
  reread,
  onError,
}: {
  current: T;
  reconcile: () => Promise<unknown>;
  reread: () => Promise<T>;
  onError: (error: unknown) => void;
}) {
  try {
    await reconcile();
    return await reread();
  } catch (error) {
    onError(error);
    return current;
  }
}
