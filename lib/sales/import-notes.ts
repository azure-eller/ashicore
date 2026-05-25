const IMPORT_NOTE_MARKER_RE = /^\[[A-Za-z0-9_-]+ rows=[^\]]+\]$/;

export function displaySalesOrderNotes(notes: string | null | undefined) {
  const trimmed = notes?.trim();
  if (!trimmed) return null;

  const lines = trimmed.split(/\r?\n/);
  if (IMPORT_NOTE_MARKER_RE.test(lines[0] ?? "")) {
    const displayLines = lines.slice(1).join("\n").trim();
    return displayLines || null;
  }

  return trimmed;
}
