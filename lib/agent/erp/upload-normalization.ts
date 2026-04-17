import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import sharp from "sharp";
import * as XLSX from "xlsx";
import type { AgentUploadManifest } from "@/lib/agent/erp/types";
import type { UploadStore } from "@/lib/agent/erp/upload-store";

const SAMPLE_ROW_LIMIT = 5;

type NormalizedUploadArtifact = {
  storageKey: string;
  sourceFilename: string;
  mediaType: string;
  normalizedKind: string;
  manifest: AgentUploadManifest;
};

function stripNumericScale(value: number) {
  return Number.isInteger(value) ? String(value) : `${value}`.replace(/\.?0+$/, "");
}

function sanitizeHeader(header: string, index: number, seen: Map<string, number>) {
  const base = header.trim() || `Column ${index + 1}`;
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base} (${count + 1})`;
}

function detectDelimiter(content: string) {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", "\t", ";", "|"];

  return candidates.reduce(
    (best, delimiter) => {
      const score = firstLine.split(delimiter).length;
      if (score > best.score) {
        return { delimiter, score };
      }

      return best;
    },
    { delimiter: ",", score: 0 }
  ).delimiter;
}

function normalizeTable(content: string, delimiter = detectDelimiter(content)) {
  const rows = parseCsv(content, {
    bom: true,
    delimiter,
    relax_column_count: true,
    skip_empty_lines: false,
  }) as string[][];

  const headerRow = rows[0] ?? [];
  const seen = new Map<string, number>();
  const headers = headerRow.map((header, index) => sanitizeHeader(`${header ?? ""}`, index, seen));

  const dataRows = rows.slice(1);
  const sampleRows = dataRows.slice(0, SAMPLE_ROW_LIMIT).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, `${row[index] ?? ""}`]))
  );

  return {
    delimiter,
    headers,
    rowCount: dataRows.length,
    sampleRows,
  };
}

function escapeCsvValue(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function toCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => escapeCsvValue(cell)).join(",")).join("\n");
}

function excelDateToIso(serial: number) {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) {
    return stripNumericScale(serial);
  }

  const date = new Date(
    Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S))
  );

  if (parsed.H === 0 && parsed.M === 0 && Math.floor(parsed.S) === 0) {
    return date.toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 19);
}

function normalizeWorkbookCell(cell: XLSX.CellObject | undefined) {
  if (!cell || cell.v == null) {
    return "";
  }

  if (cell.t === "s") {
    return `${cell.v}`;
  }

  if (cell.t === "b") {
    return cell.v ? "true" : "false";
  }

  if (cell.t === "d") {
    const value = cell.v instanceof Date ? cell.v : new Date(`${cell.v}`);
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19);
  }

  if (cell.t === "n" && typeof cell.v === "number") {
    if ((cell.z && XLSX.SSF.is_date(cell.z)) || cell.w?.includes("/")) {
      return excelDateToIso(cell.v);
    }

    if (cell.w && /^0\d+$/.test(cell.w)) {
      return cell.w;
    }

    return stripNumericScale(cell.v);
  }

  return cell.w ?? `${cell.v}`;
}

function getDenseCell(sheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number) {
  const denseSheet = sheet as unknown as XLSX.CellObject[][];
  return denseSheet[rowIndex]?.[columnIndex];
}

function workbookSheetToRows(sheet: XLSX.WorkSheet) {
  const ref = sheet["!ref"];
  if (!ref) {
    return [[]];
  }

  const range = XLSX.utils.decode_range(ref);
  const rows: string[][] = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row: string[] = [];
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      row.push(normalizeWorkbookCell(getDenseCell(sheet, rowIndex, columnIndex)));
    }
    rows.push(row);
  }

  return rows;
}

function inferMediaType(filename: string, fallback?: string) {
  if (fallback && fallback.length > 0) {
    return fallback;
  }

  const extension = path.extname(filename).toLowerCase();
  switch (extension) {
    case ".csv":
      return "text/csv";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

async function buildImageManifest(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata();

  return {
    byteSize: buffer.byteLength,
    image: {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      format: metadata.format,
    },
  } satisfies AgentUploadManifest;
}

function buildPdfManifest(buffer: Buffer) {
  const text = buffer.toString("latin1");
  const pageCount = (text.match(/\/Type\s*\/Page\b/g) ?? []).length;

  return {
    byteSize: buffer.byteLength,
    pageCount,
  } satisfies AgentUploadManifest;
}

function withTableManifest(content: string) {
  const table = normalizeTable(content);

  return {
    byteSize: Buffer.byteLength(content, "utf8"),
    table,
  } satisfies AgentUploadManifest;
}

export async function normalizeUpload(args: {
  sessionId: string;
  filename: string;
  mediaType?: string;
  buffer: Buffer;
  store: UploadStore;
}): Promise<NormalizedUploadArtifact[]> {
  const mediaType = inferMediaType(args.filename, args.mediaType);
  const rawFile = await args.store.writeBuffer({
    sessionId: args.sessionId,
    filename: args.filename,
    mediaType,
    buffer: args.buffer,
    kind: "raw",
  });

  const artifacts: NormalizedUploadArtifact[] = [];
  const extension = path.extname(args.filename).toLowerCase();

  if (extension === ".csv") {
    artifacts.push({
      storageKey: rawFile.storageKey,
      sourceFilename: args.filename,
      mediaType,
      normalizedKind: "tabular_csv",
      manifest: withTableManifest(args.buffer.toString("utf8")),
    });

    return artifacts;
  }

  if (extension === ".xlsx") {
    artifacts.push({
      storageKey: rawFile.storageKey,
      sourceFilename: args.filename,
      mediaType,
      normalizedKind: "workbook",
      manifest: {
        byteSize: args.buffer.byteLength,
      },
    });

    const workbook = XLSX.read(args.buffer, {
      type: "buffer",
      cellDates: true,
      dense: true,
    });

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = workbookSheetToRows(sheet);
      const filenameBase = path.basename(args.filename, path.extname(args.filename));
      const derivedFilename = `${filenameBase}__${sheetName}.csv`;
      const csvContent = toCsv(rows);
      const derivedFile = await args.store.writeBuffer({
        sessionId: args.sessionId,
        filename: derivedFilename,
        mediaType: "text/csv",
        buffer: Buffer.from(csvContent, "utf8"),
        kind: "derived",
      });

      artifacts.push({
        storageKey: derivedFile.storageKey,
        sourceFilename: derivedFilename,
        mediaType: "text/csv",
        normalizedKind: "normalized_table",
        manifest: {
          ...withTableManifest(csvContent),
        },
      });
    }

    return artifacts;
  }

  if (mediaType === "application/pdf" || extension === ".pdf") {
    artifacts.push({
      storageKey: rawFile.storageKey,
      sourceFilename: args.filename,
      mediaType,
      normalizedKind: "pdf",
      manifest: buildPdfManifest(args.buffer),
    });

    return artifacts;
  }

  if (mediaType.startsWith("image/")) {
    artifacts.push({
      storageKey: rawFile.storageKey,
      sourceFilename: args.filename,
      mediaType,
      normalizedKind: "image",
      manifest: await buildImageManifest(args.buffer),
    });

    return artifacts;
  }

  artifacts.push({
    storageKey: rawFile.storageKey,
    sourceFilename: args.filename,
    mediaType,
    normalizedKind: "raw",
    manifest: {
      byteSize: args.buffer.byteLength,
    },
  });

  return artifacts;
}
