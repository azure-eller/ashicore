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
    try {
      onError(error);
    } catch {
      // Reporting must not prevent Billing from rendering last-known state.
    }
    return current;
  }
}
