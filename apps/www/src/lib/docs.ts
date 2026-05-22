import type { CollectionEntry } from "astro:content";

export type DocEntry = CollectionEntry<"docs">;

export const docSectionOrder = [
  "Start here",
  "Concepts",
  "How-to",
  "Reference",
  "Design decisions",
  "Admin",
  "Developer",
];

export function docSlug(entry: Pick<DocEntry, "id">) {
  return entry.id.replace(/\.mdx?$/, "");
}

export function docUrl(entry: Pick<DocEntry, "id">) {
  return `/docs/${docSlug(entry)}`;
}

export function compareDocs(a: DocEntry, b: DocEntry) {
  const sectionDelta =
    docSectionOrder.indexOf(a.data.section) - docSectionOrder.indexOf(b.data.section);

  if (sectionDelta !== 0) {
    return sectionDelta;
  }

  return a.data.order - b.data.order || a.data.title.localeCompare(b.data.title);
}

export function groupDocs(entries: DocEntry[]) {
  const groups = new Map<string, DocEntry[]>();

  for (const entry of [...entries].sort(compareDocs)) {
    const group = groups.get(entry.data.section) ?? [];
    group.push(entry);
    groups.set(entry.data.section, group);
  }

  return docSectionOrder
    .map((section) => ({ section, entries: groups.get(section) ?? [] }))
    .filter((group) => group.entries.length > 0);
}

export function plainText(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
