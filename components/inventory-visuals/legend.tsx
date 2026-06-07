import { ItemSprite } from "./item-sprite";
import { InventoryVisualCell, InventoryVisualPanel } from "./visual-panel";
import type { ItemColorFamily, ItemSpriteKind } from "./types";

type PackagingLegendEntry = {
  kind: ItemSpriteKind;
  color: ItemColorFamily;
  label: string;
  meaning: string;
};

const PACKAGING_LEGEND: PackagingLegendEntry[] = [
  {
    kind: "bag-1cf",
    color: "green",
    label: "1 cu ft bag",
    meaning: "Smaller bag, slumped or laid down.",
  },
  {
    kind: "bag-2cf",
    color: "green",
    label: "2 cu ft / bag",
    meaning: "Standard larger retail soil bag.",
  },
  {
    kind: "tote",
    color: "green",
    label: "Soil tote",
    meaning: "Cubic yard tote with four corner loops.",
  },
  {
    kind: "bulk",
    color: "amber",
    label: "Bulk pile",
    meaning: "Loose soil, compost, sand, or aggregate.",
  },
  {
    kind: "sack",
    color: "amber",
    label: "Ingredient sack",
    meaning: "Flexible sack or raw input bag.",
  },
];

const COLOR_LEGEND: Array<{
  color: ItemColorFamily;
  label: string;
  meaning: string;
}> = [
  { color: "green", label: "Green", meaning: "Soils, organics, plants, fertilizers." },
  { color: "amber", label: "Amber", meaning: "Dry inputs, packaging, sand, mulch." },
  { color: "blue", label: "Blue", meaning: "Liquids, water, solutions." },
  { color: "purple", label: "Purple", meaning: "Finished goods, blends, kits." },
  { color: "slate", label: "Slate", meaning: "Parts, hardware, miscellaneous stock." },
  { color: "red", label: "Red", meaning: "Hazards, acids, fragile materials." },
];

export function InventoryVisualLegend() {
  return (
    <section className="grid gap-(--space-6) lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
      <InventoryVisualPanel className="space-y-(--space-5)">
        <h2 className="font-mono text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">Packaging Legend</h2>
        <div className="grid gap-(--space-3) sm:grid-cols-2">
          {PACKAGING_LEGEND.map((entry) => (
            <InventoryVisualCell
              key={entry.label}
              className="grid min-h-(--space-24) grid-cols-[4rem_minmax(0,1fr)] items-center gap-(--space-4) rounded-[var(--radius-md)] border border-[var(--color-line-soft)] p-(--space-4)"
            >
              <ItemSprite
                kind={entry.kind}
                color={entry.color}
                size="lg"
                title={entry.label}
              />
              <div className="min-w-0">
                <div className="text-[length:var(--text-sm)] font-medium text-[var(--color-ink)]">{entry.label}</div>
                <div className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">{entry.meaning}</div>
              </div>
            </InventoryVisualCell>
          ))}
        </div>
      </InventoryVisualPanel>

      <InventoryVisualPanel className="space-y-(--space-5)">
        <h2 className="font-mono text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">Color Legend</h2>
        <div className="grid gap-(--space-3)">
          {COLOR_LEGEND.map((entry) => (
            <InventoryVisualCell
              key={entry.color}
              className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-(--space-4) rounded-[var(--radius-md)] border border-[var(--color-line-soft)] p-(--space-3)"
            >
              <ItemSprite
                kind="generic"
                color={entry.color}
                size="sm"
                title={`${entry.label} example`}
              />
              <div className="min-w-0">
                <div className="text-[length:var(--text-sm)] font-medium text-[var(--color-ink)]">{entry.label}</div>
                <div className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">{entry.meaning}</div>
              </div>
            </InventoryVisualCell>
          ))}
        </div>
      </InventoryVisualPanel>
    </section>
  );
}
