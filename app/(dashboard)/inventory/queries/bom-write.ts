export type BomInputRow = {
  componentId: string;
  quantity: string;
  minimumLotAgeDays?: number | null;
  alternates?: Array<{ itemId: string }>;
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
