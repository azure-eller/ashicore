export type ItemDisplayNameInput = {
  name: string;
  familyName?: string | null;
  optionLabels?: readonly string[];
  deletedAt?: Date | string | null;
};

/**
 * Canonical operator-facing name for an inventory item.
 *
 * Assigned option values are part of a variant's identity, including values
 * that were later disabled. Disabled values cannot be selected for new
 * variants, but existing and historical references must keep their suffix.
 */
export function formatItemDisplayName({
  name,
  familyName,
  optionLabels = [],
  deletedAt = null,
}: ItemDisplayNameInput) {
  const baseName = familyName ?? name;
  const labels = optionLabels.filter((label) => label.trim() !== "");
  const displayName =
    labels.length > 0 ? `${baseName} / ${labels.join(" / ")}` : baseName;

  return deletedAt ? `${displayName} (deleted)` : displayName;
}

/**
 * Preserve a document's snapshotted base name while repairing legacy rows
 * that were saved before variant suffixes became part of the snapshot.
 */
export function formatItemSnapshotDisplayName(
  snapshotName: string,
  optionLabels: readonly string[],
  currentBaseNames: readonly (string | null | undefined)[] = [],
) {
  const labels = optionLabels.filter((label) => label.trim() !== "");
  if (labels.length === 0) return snapshotName;

  const suffix = ` / ${labels.join(" / ")}`;
  if (snapshotName.endsWith(suffix)) return snapshotName;

  const matchesCurrentBaseName = currentBaseNames.some(
    (baseName) => baseName != null && snapshotName === baseName,
  );
  if (!matchesCurrentBaseName && snapshotName.includes(" / ")) {
    return snapshotName;
  }

  return `${snapshotName}${suffix}`;
}
