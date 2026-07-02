import {
  CardCheckboxField,
  CardField,
} from "@/components/card-page/card-field";
import type { ItemCardDto } from "@/lib/api/clients/item-cards";

type SellableCardFieldProps = {
  variants: ItemCardDto["variants"];
  disabled: boolean;
  onChange: (sellable: boolean) => void;
};

export function SellableCardField({
  variants,
  disabled,
  onChange,
}: SellableCardFieldProps) {
  const visibleVariants = variants.filter((variant) => variant.deletedAt == null);
  const sellableChecked =
    visibleVariants.length > 0 && visibleVariants.every((variant) => variant.sellable);
  const sellableIndeterminate =
    visibleVariants.some((variant) => variant.sellable) &&
    visibleVariants.some((variant) => !variant.sellable);

  return (
    <CardField label="Usability">
      <CardCheckboxField
        label="Sellable"
        checked={sellableIndeterminate ? "indeterminate" : sellableChecked}
        disabled={disabled || visibleVariants.length === 0}
        onCheckedChange={(checked) => {
          onChange(checked === true);
        }}
      />
    </CardField>
  );
}
