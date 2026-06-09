import * as XLSX from "xlsx";

export type WorkbookReadOptions = {
  maxRowsPerSheet?: number;
  maxCellsPerSheet?: number;
  maxCommentCellsPerSheet?: number;
  maxInventorySignalsPerSheet?: number;
  maxMergedRangesPerSheet?: number;
  topRowsPerSheet?: number;
};

export type WorkbookInventoryHeaderCandidate = {
  name: string;
  sheet: string;
  cell: string;
  row: number;
};

const DEFAULT_MAX_ROWS_PER_SHEET = 140;
const DEFAULT_MAX_CELLS_PER_SHEET = 900;
const DEFAULT_MAX_COMMENT_CELLS_PER_SHEET = 80;
const DEFAULT_MAX_INVENTORY_SIGNALS_PER_SHEET = 60;
const DEFAULT_MAX_MERGED_RANGES_PER_SHEET = 40;
const DEFAULT_TOP_ROWS_PER_SHEET = 40;
const MAX_COMMENTS_PER_CELL = 5;
const MAX_CELL_TEXT_LENGTH = 320;
const MAX_ROW_TEXT_LENGTH = 1_400;
const SIGNAL_PATTERN =
  /\b(inventory|stock|count|available|aged|fresh|pallet|pallets|bag|bags|tote|totes|yard|yards|order|orders|customer|supplier|bom|recipe|batch|formula|qty|quantity|on hand|allocated)\b|(?:\d+\s*p\s*=)|(?:p\s*=\s*\d+)/i;
const INVENTORY_SIGNAL_PATTERN =
  /\b(inventory|stock|available|aged|fresh|pallet|pallets|bag|bags|tote|totes|yard|yards|cy|cyd|cyt|2cf|1cf|cfb|on hand|allocated|eod|sod)\b|(?:\d+\s*p\s*=)|(?:p\s*=\s*\d+)/i;

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 20)}... [truncated]`;
}

function cellCommentText(cell: XLSX.CellObject) {
  const comments = cell.c ?? [];
  const formattedComments = comments
    .slice(0, MAX_COMMENTS_PER_CELL)
    .map((comment) => {
      const author = comment.a?.trim();
      const text = comment.t?.trim();
      if (!text) return null;
      const formatted = author ? `${author}: ${text}` : text;
      return truncate(formatted, MAX_CELL_TEXT_LENGTH);
    })
    .filter((comment): comment is string => Boolean(comment));
  if (comments.length > MAX_COMMENTS_PER_CELL) {
    formattedComments.push(`... ${comments.length - MAX_COMMENTS_PER_CELL} more comments omitted`);
  }
  return formattedComments;
}

function cellDisplayValue(cell: XLSX.CellObject) {
  if (cell.w != null) return String(cell.w);
  if (cell.v == null) return "";
  return String(cell.v);
}

function formatCell(address: string, cell: XLSX.CellObject) {
  const parts = [`${address}=${JSON.stringify(truncate(cellDisplayValue(cell), MAX_CELL_TEXT_LENGTH))}`];
  if (cell.f) parts.push(`formula=${JSON.stringify(truncate(cell.f, MAX_CELL_TEXT_LENGTH))}`);
  const comments = cellCommentText(cell);
  if (comments.length > 0) parts.push(`comments=${JSON.stringify(comments)}`);
  return parts.join(" ");
}

function formatMergedRanges(sheet: XLSX.WorkSheet, maxRanges: number) {
  const ranges = (sheet["!merges"] ?? []).map((range) => XLSX.utils.encode_range(range));
  if (ranges.length <= maxRanges) return ranges.join(", ");
  return `${ranges.slice(0, maxRanges).join(", ")} ... (${ranges.length - maxRanges} more)`;
}

function sheetHiddenState(workbook: XLSX.WorkBook, sheetIndex: number) {
  const hidden = workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden;
  if (hidden === 1) return "hidden";
  if (hidden === 2) return "very_hidden";
  return "visible";
}

function isVisibleSheet(workbook: XLSX.WorkBook, sheetIndex: number) {
  return sheetHiddenState(workbook, sheetIndex) === "visible";
}

export function workbookSheetRole(sheetName: string) {
  const normalized = sheetName.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\b(current|active|inventory|on hand|stock)\b/.test(normalized)) {
    return "current_candidate";
  }
  if (/\b(archive|archived|history|historical|prior)\b/.test(normalized)) {
    return "historical";
  }
  if (/\b(advanced|future|forecast|plan|batch totals?|rollup|summary)\b/.test(normalized)) {
    return "future_or_planning";
  }
  return "general";
}

function shouldElevateInventorySignals(role: string) {
  return role === "current_candidate" || role === "general";
}

function isGenericInventoryHeader(value: string) {
  return /^(?:customer|current|current inventory|current orders|inventory counts?|orders?|invoice|payment|target|ready date|fulfillment date|address|poc|phone|special instructions?|notes?|misc|bags?|totes?|1cfb|2cfb|3cfb|fresh totes?|aged totes?|on hold)$/i.test(
    value.trim(),
  );
}

function isProductLikeHeader(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.length >= 4 &&
    /[a-z]/i.test(trimmed) &&
    !isGenericInventoryHeader(trimmed) &&
    !/\b(current inventory|current orders?|inventory counts?|production capacity|bagging capacity|warehouse requisitions?|target|payment|invoice|fulfillment|poc|phone|special instructions?|notes?)\b/i.test(trimmed) &&
    !/^(?:product|material|supplier|customer|sku|uom|unit|unit cost|cost|price|qty|quantity|on hand|stock|formula)$/i.test(trimmed) &&
    !/^(?:cu\s*ft|cu\s*yd|lb|oz|g|kg|ea|pcs|packet|cubic yard tote)$/i.test(trimmed) &&
    !/^\d+(?:\.\d+)?\s*(?:lb|oz|g|kg|cu\s*ft|cu\s*yd|cfb|cyd|cyt|cy)\b/i.test(trimmed) &&
    !/^[A-Z]{2,}[-_][A-Z0-9_-]+$/i.test(trimmed)
  );
}

function cellSignalText(address: string, cell: XLSX.CellObject) {
  const comments = cellCommentText(cell);
  return [
    address,
    cellDisplayValue(cell),
    cell.f ?? "",
    ...comments,
  ].join(" ");
}

function nearbyColumnHeaders(sheet: XLSX.WorkSheet, row: number, col: number, sheetStartRow: number) {
  const headers: string[] = [];
  for (let candidateRow = row - 1; candidateRow >= Math.max(sheetStartRow, row - 8); candidateRow -= 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: candidateRow, c: col })];
    if (!cell) continue;
    const value = cellDisplayValue(cell).trim();
    if (value && !headers.includes(value)) headers.push(value);
    if (headers.length >= 3) break;
  }
  return headers;
}

function nearbyRowHeaders(sheet: XLSX.WorkSheet, row: number, col: number, sheetStartCol: number) {
  const headers: string[] = [];
  for (let candidateCol = col - 1; candidateCol >= Math.max(sheetStartCol, col - 6); candidateCol -= 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: candidateCol })];
    if (!cell) continue;
    const value = cellDisplayValue(cell).trim();
    if (value && !headers.includes(value)) headers.push(value);
    if (headers.length >= 3) break;
  }
  return headers;
}

function shouldEmitRow(
  rowIndex: number,
  sheetStartRow: number,
  rowCells: XLSX.CellObject[],
  topRowsPerSheet: number,
) {
  if (rowIndex < sheetStartRow + topRowsPerSheet) return true;
  return rowCells.some((cell) => SIGNAL_PATTERN.test(cellSignalText("", cell)));
}

function collectCommentAndFormulaIndex(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  options: Required<WorkbookReadOptions>,
) {
  const entries: string[] = [];
  let totalEntries = 0;

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];
      if (!cell) continue;
      const comments = cellCommentText(cell);
      if (!cell.f && comments.length === 0) continue;
      totalEntries += 1;
      if (entries.length >= options.maxCommentCellsPerSheet) continue;
      entries.push(formatCell(address, cell));
    }
  }

  if (totalEntries > entries.length) {
    entries.push(`... ${totalEntries - entries.length} more comment/formula cells omitted`);
  }

  return entries;
}

function collectInventorySignalIndex(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  options: Required<WorkbookReadOptions>,
) {
  const entries: string[] = [];
  let totalEntries = 0;

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];
      if (!cell) continue;
      const signalText = cellSignalText(address, cell);
      if (!INVENTORY_SIGNAL_PATTERN.test(signalText)) continue;
      totalEntries += 1;
      if (entries.length >= options.maxInventorySignalsPerSheet) continue;

      const columnHeaders = nearbyColumnHeaders(sheet, row, col, range.s.r);
      const rowHeaders = nearbyRowHeaders(sheet, row, col, range.s.c);
      const context = [
        columnHeaders.length > 0 ? `columnContext=${JSON.stringify(columnHeaders)}` : null,
        rowHeaders.length > 0 ? `rowContext=${JSON.stringify(rowHeaders)}` : null,
      ].filter((part): part is string => part != null);
      entries.push(`${formatCell(address, cell)}${context.length > 0 ? ` ${context.join(" ")}` : ""}`);
    }
  }

  if (totalEntries > entries.length) {
    entries.push(`... ${totalEntries - entries.length} more inventory signal cells omitted`);
  }

  return entries;
}

function worksheetToStructuredText(
  workbook: XLSX.WorkBook,
  sheetName: string,
  sheetIndex: number,
  options: Required<WorkbookReadOptions>,
) {
  const sheet = workbook.Sheets[sheetName];
  const rangeRef = sheet["!ref"];
  const role = workbookSheetRole(sheetName);
  const lines = [
    `Sheet: ${sheetName}`,
    `Sheet role: ${role}`,
    `Visibility: ${sheetHiddenState(workbook, sheetIndex)}`,
    `Used range: ${rangeRef ?? "empty"}`,
  ];

  const mergedRanges = formatMergedRanges(sheet, options.maxMergedRangesPerSheet);
  if (mergedRanges) {
    lines.push(`Merged ranges: ${mergedRanges}`);
  }

  if (!rangeRef) return lines.join("\n");

  const range = XLSX.utils.decode_range(rangeRef);
  if (!shouldElevateInventorySignals(role)) {
    lines.push("Sheet detail omitted for historical/future/planning sheet.");
    return lines.join("\n");
  }

  const maxRow = Math.min(range.e.r, range.s.r + options.maxRowsPerSheet - 1);
  let emittedCells = 0;
  let truncated = false;

  const inventoryEntries = collectInventorySignalIndex(sheet, range, options);
  if (inventoryEntries.length > 0) {
    lines.push("Inventory signal index:");
    lines.push(...inventoryEntries.map((entry) => `- ${entry}`));
  }

  const indexEntries = collectCommentAndFormulaIndex(sheet, range, options);
  if (indexEntries.length > 0) {
    lines.push("Comment/formula index:");
    lines.push(...indexEntries.map((entry) => `- ${entry}`));
  }

  lines.push("Relevant cells:");
  for (let row = range.s.r; row <= maxRow; row += 1) {
    const rowCells: string[] = [];
    const sourceCells: XLSX.CellObject[] = [];
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];
      if (!cell) continue;
      const value = cellDisplayValue(cell);
      const comments = cellCommentText(cell);
      if (!value && !cell.f && comments.length === 0) continue;
      sourceCells.push(cell);
      rowCells.push(formatCell(address, cell));
    }
    if (
      rowCells.length > 0 &&
      shouldEmitRow(row, range.s.r, sourceCells, options.topRowsPerSheet)
    ) {
      if (emittedCells + rowCells.length > options.maxCellsPerSheet) {
        truncated = true;
        break;
      }
      lines.push(truncate(`Row ${row + 1}: ${rowCells.join(" | ")}`, MAX_ROW_TEXT_LENGTH));
      emittedCells += rowCells.length;
    }
    if (truncated) break;
  }

  if (range.e.r > maxRow) {
    lines.push(`Truncated after row ${maxRow + 1} of ${range.e.r + 1}.`);
  }
  if (truncated) {
    lines.push(`Truncated after ${options.maxCellsPerSheet} non-empty cells.`);
  }

  return lines.join("\n");
}

export function workbookToStructuredText(
  bytes: Buffer,
  inputOptions: WorkbookReadOptions = {},
) {
  const options = {
    maxRowsPerSheet: inputOptions.maxRowsPerSheet ?? DEFAULT_MAX_ROWS_PER_SHEET,
    maxCellsPerSheet: inputOptions.maxCellsPerSheet ?? DEFAULT_MAX_CELLS_PER_SHEET,
    maxCommentCellsPerSheet:
      inputOptions.maxCommentCellsPerSheet ?? DEFAULT_MAX_COMMENT_CELLS_PER_SHEET,
    maxInventorySignalsPerSheet:
      inputOptions.maxInventorySignalsPerSheet ?? DEFAULT_MAX_INVENTORY_SIGNALS_PER_SHEET,
    maxMergedRangesPerSheet:
      inputOptions.maxMergedRangesPerSheet ?? DEFAULT_MAX_MERGED_RANGES_PER_SHEET,
    topRowsPerSheet: inputOptions.topRowsPerSheet ?? DEFAULT_TOP_ROWS_PER_SHEET,
  };
  const workbook = XLSX.read(bytes, {
    type: "buffer",
    cellDates: true,
    cellFormula: true,
    cellHTML: false,
    cellNF: true,
    cellStyles: true,
  });

  return [
    "Workbook structure:",
    `Sheets: ${workbook.SheetNames.join(", ")}`,
    "",
    ...workbook.SheetNames.map((sheetName, index) =>
      worksheetToStructuredText(workbook, sheetName, index, options),
    ),
  ].join("\n\n");
}

export function workbookCurrentInventoryHeaderCandidates(bytes: Buffer) {
  const workbook = XLSX.read(bytes, {
    type: "buffer",
    cellDates: true,
    cellFormula: true,
    cellHTML: false,
    cellNF: true,
    cellStyles: true,
  });
  const candidates: WorkbookInventoryHeaderCandidate[] = [];

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    if (!isVisibleSheet(workbook, sheetIndex) || workbookSheetRole(sheetName) !== "current_candidate") {
      return;
    }

    const sheet = workbook.Sheets[sheetName];
    const rangeRef = sheet["!ref"];
    if (!rangeRef) return;

    const range = XLSX.utils.decode_range(rangeRef);
    const maxRow = Math.min(range.e.r, range.s.r + 11);
    for (let row = range.s.r; row <= maxRow; row += 1) {
      const rowValues: string[] = [];
      const rowCells: Array<{ address: string; cell: XLSX.CellObject; value: string }> = [];
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = sheet[address];
        if (!cell) continue;
        const value = cellDisplayValue(cell).trim();
        if (value) rowValues.push(value);
        rowCells.push({ address, cell, value });
      }

      const rowContext = rowValues.join(" ");
      const rowLooksLikeInventory =
        /\bcurrent inventory\b/i.test(rowContext) ||
        rowCells.some(({ cell }) => cellCommentText(cell).some((comment) => INVENTORY_SIGNAL_PATTERN.test(comment)));
      if (!rowLooksLikeInventory) continue;

      for (const { address, cell, value } of rowCells) {
        if (!isProductLikeHeader(value)) continue;
        const cellHasInventoryComment = cellCommentText(cell).some((comment) =>
          INVENTORY_SIGNAL_PATTERN.test(comment),
        );
        const isStructuredNameColumn = address.match(/^[A-Z]+/)?.[0] === XLSX.utils.encode_col(range.s.c) && row > range.s.r;
        if (!cellHasInventoryComment && !isStructuredNameColumn) continue;
        candidates.push({
          name: value,
          sheet: sheetName,
          cell: address,
          row: row + 1,
        });
      }
    }
  });

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function workbookRowText(bytes: Buffer, sheetName: string, rowNumber: number) {
  const workbook = XLSX.read(bytes, {
    type: "buffer",
    cellDates: true,
    cellFormula: true,
    cellHTML: false,
    cellNF: true,
    cellStyles: true,
  });
  const sheet = workbook.Sheets[sheetName];
  const rangeRef = sheet?.["!ref"];
  if (!sheet || !rangeRef) return "";

  const range = XLSX.utils.decode_range(rangeRef);
  const rowIndex = rowNumber - 1;
  if (rowIndex < range.s.r || rowIndex > range.e.r) return "";

  const values: string[] = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: col })];
    if (!cell) continue;
    const displayValue = cellDisplayValue(cell).trim();
    if (displayValue) values.push(displayValue);
    values.push(...cellCommentText(cell));
  }
  return values.join(" ");
}
