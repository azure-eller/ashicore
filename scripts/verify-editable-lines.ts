import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components"];

const RAW_GRID_ALLOWED = new Set([
  "components/editable-lines.tsx",
  "components/card-page/variant-table.tsx",
  "components/card-page/lot-grid-tab.tsx",
  "app/(dashboard)/inventory/stocktakes/stocktake-detail.tsx",
]);

const CELL_EDITOR_FILE_ALLOWED = new Set([
  "components/editable-lines.tsx",
  "components/ag-grid-date-cell-editor.tsx",
]);

const SHARED_CELL_EDITORS = new Set([
  "InventoryItemLineCellEditor",
  "SelectLineCellEditor",
  "TextLineCellEditor",
  "AgGridDateCellEditor",
]);

function listFiles(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  const files: string[] = [];

  for (const entry of readdirSync(absolute)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const entryPath = path.join(absolute, entry);
    const relative = path.relative(ROOT, entryPath);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      files.push(...listFiles(relative));
    } else if (entry.endsWith(".tsx")) {
      files.push(relative);
    }
  }

  return files;
}

const violations: string[] = [];

for (const file of SCAN_DIRS.flatMap(listFiles)) {
  const source = readFileSync(path.join(ROOT, file), "utf8");

  if (
    !RAW_GRID_ALLOWED.has(file) &&
    source.includes("@/components/editable-line-data-grid")
  ) {
    violations.push(
      `${file}: import line grids from "@/components/editable-lines", not raw EditableLineDataGrid.`,
    );
  }

  if (!CELL_EDITOR_FILE_ALLOWED.has(file) && /\b(function|const)\s+\w*CellEditor\b/.test(source)) {
    violations.push(
      `${file}: custom line cell editors belong in components/editable-lines.tsx.`,
    );
  }

  if (
    !CELL_EDITOR_FILE_ALLOWED.has(file) &&
    !RAW_GRID_ALLOWED.has(file) &&
    /\bcellEditor(?:Params|Popup)?\s*:/.test(source)
  ) {
    violations.push(
      `${file}: normal app code must not configure AG Grid cell editors directly. Use the LineField kind on MutableLines/ManagedEditableLines/FixedEditableLines, or add a reviewed raw-grid exception for a custom workflow grid.`,
    );
  }

  const cellEditorMatches = source.matchAll(/\bcellEditor:\s*([A-Za-z_$][\w$]*)/g);
  for (const match of cellEditorMatches) {
    const editorName = match[1];
    if (SHARED_CELL_EDITORS.has(editorName)) continue;
    violations.push(
      `${file}: cellEditor "${editorName}" is not a shared line editor. Use a string AG Grid editor or promote the editor to components/editable-lines.tsx.`,
    );
  }
}

if (violations.length > 0) {
  console.error("Editable line guard failed:\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}
