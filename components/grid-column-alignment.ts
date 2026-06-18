import type {
  CellClassParams,
  ColDef,
  ColGroupDef,
  HeaderClassParams,
} from "ag-grid-community";

// Single enforcement point for grid column alignment. A column whose values
// render right-aligned (numeric / currency) must always get a matching
// right-aligned header, so the two can never drift apart per-table.
//
// Cells are display:flex in this app, so `text-align: right` is inert — the
// real right-align is `num-end` (`justify-content: flex-end`). The header
// right-align is AG Grid's own `ag-right-aligned-header`, handled by the theme.

const RIGHT_ALIGNED_HEADER_CLASS = "ag-right-aligned-header";
const RIGHT_ALIGNED_CELL_CLASS = "num-end";

// Any of these on a column means its values are right-aligned.
const RIGHT_ALIGNED_CELL_TOKENS = new Set([
  "num",
  "num-end",
  "text-right",
  "ag-right-aligned-cell",
]);
const RIGHT_ALIGNED_TYPES = new Set(["rightAligned", "numericColumn"]);

function classTokens(value: string | string[] | null | undefined): string[] {
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(classTokens);
  return [];
}

function typeList(type: ColDef["type"]): string[] {
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type;
  return [];
}

// Class functions are evaluated per cell/header and can't be inspected here, so
// such columns must declare numeric intent statically (a `num`/`text-right`
// class or a `numericColumn`/`rightAligned` type).
function staticTokens(value: ColDef["cellClass"] | ColDef["headerClass"]): string[] {
  if (typeof value === "function") return [];
  return classTokens(value as string | string[] | null | undefined);
}

function isRightAligned<TData>(col: ColDef<TData>): boolean {
  if (typeList(col.type).some((type) => RIGHT_ALIGNED_TYPES.has(type))) return true;
  if (staticTokens(col.cellClass).some((token) => RIGHT_ALIGNED_CELL_TOKENS.has(token))) {
    return true;
  }
  return staticTokens(col.headerClass).includes(RIGHT_ALIGNED_HEADER_CLASS);
}

type ClassValue<P> =
  | string
  | string[]
  | ((params: P) => string | string[] | null | undefined)
  | null
  | undefined;

function withClass<P>(existing: ClassValue<P>, className: string): string[] | ((params: P) => string[]) {
  if (typeof existing === "function") {
    return (params: P) => {
      const tokens = classTokens(existing(params) ?? undefined);
      return tokens.includes(className) ? tokens : [...tokens, className];
    };
  }
  const tokens = classTokens(existing);
  return tokens.includes(className) ? tokens : [...tokens, className];
}

function alignColumn<TData>(col: ColDef<TData>): ColDef<TData> {
  if (!isRightAligned(col)) return col;
  return {
    ...col,
    headerClass: withClass<HeaderClassParams<TData>>(
      col.headerClass as ClassValue<HeaderClassParams<TData>>,
      RIGHT_ALIGNED_HEADER_CLASS,
    ) as ColDef<TData>["headerClass"],
    cellClass: withClass<CellClassParams<TData>>(
      col.cellClass as ClassValue<CellClassParams<TData>>,
      RIGHT_ALIGNED_CELL_CLASS,
    ) as ColDef<TData>["cellClass"],
  };
}

/**
 * Binds header alignment to cell alignment for every grid column: numeric /
 * currency columns get a right-aligned header to match their right-aligned
 * values; everything else stays left/left. Run by ERPDataGrid and
 * EditableLineDataGrid so individual tables never set header alignment by hand.
 */
export function withConsistentAlignment<TData>(
  columns: Array<ColDef<TData> | ColGroupDef<TData>>,
): Array<ColDef<TData> | ColGroupDef<TData>> {
  return columns.map((col) =>
    "children" in col
      ? { ...col, children: withConsistentAlignment(col.children) }
      : alignColumn(col),
  );
}
