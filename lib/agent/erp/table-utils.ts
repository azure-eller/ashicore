import { parse as parseCsv } from "csv-parse/sync";
import type { ToolFileStore, ToolRuntimeUpload } from "@/lib/agent/core/Tool";
import type { AgentUploadManifest } from "@/lib/agent/erp/types";

export type SessionTableRow = {
  rowNumber: number;
  values: Record<string, string>;
};

export type SessionTable = {
  upload: ToolRuntimeUpload;
  headers: string[];
  rows: SessionTableRow[];
};

function getTableManifest(upload: ToolRuntimeUpload) {
  const manifest = upload.manifest as AgentUploadManifest;
  return manifest.table ?? null;
}

export function getFirstTabularUpload(uploads: ToolRuntimeUpload[]) {
  return uploads.find((upload) => getTableManifest(upload) != null) ?? null;
}

export function getUploadById(uploads: ToolRuntimeUpload[], uploadId?: string) {
  if (!uploadId) {
    return getFirstTabularUpload(uploads);
  }

  return uploads.find((upload) => upload.id === uploadId) ?? null;
}

export async function readSessionTable(args: {
  uploads: ToolRuntimeUpload[];
  fileStore: ToolFileStore;
  uploadId?: string;
}) {
  const upload = getUploadById(args.uploads, args.uploadId);
  if (!upload) {
    throw new Error("No tabular upload found in this session.");
  }

  const tableManifest = getTableManifest(upload);
  if (!tableManifest) {
    throw new Error("The selected upload is not a tabular CSV artifact.");
  }

  const content = await args.fileStore.readText(upload.storageKey);
  const rows = parseCsv(content, {
    bom: true,
    delimiter: tableManifest.delimiter,
    relax_column_count: true,
    skip_empty_lines: false,
  }) as string[][];

  const headers = tableManifest.headers;
  const tableRows = rows.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    values: Object.fromEntries(headers.map((header, headerIndex) => [header, `${row[headerIndex] ?? ""}`])),
  }));

  return {
    upload,
    headers,
    rows: tableRows,
  } satisfies SessionTable;
}

export function inferColumnType(values: string[]) {
  const populated = values.map((value) => value.trim()).filter(Boolean);
  if (populated.length === 0) {
    return "empty";
  }

  if (populated.every((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))) {
    return "email";
  }

  if (populated.every((value) => /^[+()\-\s\d]+$/.test(value))) {
    return "phone";
  }

  if (populated.every((value) => /^-?\d+(\.\d+)?$/.test(value))) {
    return "number";
  }

  return "text";
}

export function previewRows(
  rows: SessionTableRow[],
  headers: string[],
  offset = 0,
  limit = 20,
  maxColumns = 40
) {
  const selectedHeaders = headers.slice(0, maxColumns);

  return rows.slice(offset, offset + limit).map((row) => ({
    rowNumber: row.rowNumber,
    values: Object.fromEntries(selectedHeaders.map((header) => [header, row.values[header] ?? ""])),
  }));
}

export function searchRows(args: {
  rows: SessionTableRow[];
  query: string;
  column?: string;
  limit?: number;
}) {
  const normalizedQuery = args.query.trim().toLowerCase();
  const limit = args.limit ?? 20;

  return args.rows
    .filter((row) => {
      if (args.column) {
        return (row.values[args.column] ?? "").toLowerCase().includes(normalizedQuery);
      }

      return Object.values(row.values).some((value) =>
        value.toLowerCase().includes(normalizedQuery)
      );
    })
    .slice(0, limit);
}
