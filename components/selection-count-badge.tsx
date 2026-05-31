export function SelectionCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span
      aria-hidden
      className="absolute -top-(--space-2) -right-(--space-2) flex h-(--space-8) min-w-(--space-8) items-center justify-center bg-primary px-(--space-1) font-mono text-[length:var(--text-2xs)] font-medium tabular-nums text-primary-foreground"
    >
      {count}
    </span>
  );
}
