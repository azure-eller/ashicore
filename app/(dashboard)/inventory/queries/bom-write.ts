export type BomInputRow = {
  componentId: string;
  quantity: string;
  minimumLotAgeDays?: number | null;
  alternates?: Array<{ itemId: string }>;
};

export type BomOperationCostInputRow = {
  operationName: string;
  resourceId: string;
  costScalingMode: "per_output_unit";
  crewSize: string;
  plannedMinutes: string;
  loadedCostPerHour?: string | null;
};

function normalizeBomRows(bom: BomInputRow[]) {
  return bom.map((row, index) => ({
    componentId: row.componentId,
    quantity: row.quantity,
    minimumLotAgeDays: row.minimumLotAgeDays ?? null,
    alternates: (row.alternates ?? []).map((alternate) => alternate.itemId).sort(),
    sortOrder: index,
  }));
}

export function hasBomChanged(currentBom: BomInputRow[], nextBom: BomInputRow[]) {
  const normalizedCurrent = normalizeBomRows(currentBom);
  const normalizedNext = normalizeBomRows(nextBom);

  if (normalizedCurrent.length !== normalizedNext.length) {
    return true;
  }

  return normalizedCurrent.some((row, index) => {
    const nextRow = normalizedNext[index];
    return (
      row.componentId !== nextRow.componentId ||
      row.quantity !== nextRow.quantity ||
      row.minimumLotAgeDays !== nextRow.minimumLotAgeDays ||
      row.alternates.join(",") !== nextRow.alternates.join(",") ||
      row.sortOrder !== nextRow.sortOrder
    );
  });
}

function normalizeOperationCostRows(operationCosts: BomOperationCostInputRow[]) {
  return operationCosts.map((row, index) => ({
    operationName: row.operationName.trim(),
    resourceId: row.resourceId,
    costScalingMode: row.costScalingMode,
    crewSize: row.crewSize,
    plannedMinutes: row.plannedMinutes,
    loadedCostPerHour: row.loadedCostPerHour ?? null,
    sortOrder: index,
  }));
}

export function hasBomOperationCostsChanged(
  currentRows: BomOperationCostInputRow[],
  nextRows: BomOperationCostInputRow[]
) {
  const normalizedCurrent = normalizeOperationCostRows(currentRows);
  const normalizedNext = normalizeOperationCostRows(nextRows);

  if (normalizedCurrent.length !== normalizedNext.length) {
    return true;
  }

  return normalizedCurrent.some((row, index) => {
    const nextRow = normalizedNext[index];
    return (
      row.operationName !== nextRow.operationName ||
      row.resourceId !== nextRow.resourceId ||
      row.crewSize !== nextRow.crewSize ||
      row.plannedMinutes !== nextRow.plannedMinutes ||
      row.loadedCostPerHour !== nextRow.loadedCostPerHour ||
      row.sortOrder !== nextRow.sortOrder
    );
  });
}
