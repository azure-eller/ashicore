export type BomInputRow = {
  componentId: string;
  quantity: string;
  consumptionMode?: "per_output_unit" | "per_batch" | "per_group";
  basisOutputQuantity?: string | null;
  batchScalingMode?: "proportional" | "full_batches_only" | null;
  groupRemainderPolicy?: "ask" | "leave_loose" | "create_partial_group" | null;
  minimumLotAgeDays?: number | null;
  alternates?: Array<{ itemId: string }>;
};

function normalizeBomRows(bom: BomInputRow[]) {
  return bom.map((row, index) => ({
    componentId: row.componentId,
    quantity: row.quantity,
    consumptionMode: row.consumptionMode ?? "per_output_unit",
    basisOutputQuantity: row.basisOutputQuantity ?? null,
    batchScalingMode: row.batchScalingMode ?? null,
    groupRemainderPolicy: row.groupRemainderPolicy ?? null,
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
      row.consumptionMode !== nextRow.consumptionMode ||
      row.basisOutputQuantity !== nextRow.basisOutputQuantity ||
      row.batchScalingMode !== nextRow.batchScalingMode ||
      row.groupRemainderPolicy !== nextRow.groupRemainderPolicy ||
      row.minimumLotAgeDays !== nextRow.minimumLotAgeDays ||
      row.alternates.join(",") !== nextRow.alternates.join(",") ||
      row.sortOrder !== nextRow.sortOrder
    );
  });
}
