export const STOCKTAKE_NAME_MAX_LENGTH = 255;
export const STOCKTAKE_NAME_MAX_LENGTH_MESSAGE = `Name must be ${STOCKTAKE_NAME_MAX_LENGTH} characters or fewer.`;

export function stocktakeDateToken(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function defaultStocktakeCopyName(sourceName: string, date = new Date()) {
  const dateToken = stocktakeDateToken(date);
  const prefix = "Copy of ";
  const suffix = ` - ${dateToken}`;
  const sourceNameMaxLength =
    STOCKTAKE_NAME_MAX_LENGTH - prefix.length - suffix.length;

  return `${prefix}${sourceName.slice(0, sourceNameMaxLength)}${suffix}`;
}
