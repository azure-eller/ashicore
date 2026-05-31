import {
  ITEM_COLOR_FAMILIES,
  ITEM_SPRITE_KINDS,
  ITEM_VISUAL_SIZES,
  ITEM_VISUAL_STATES,
  type ItemColorFamily,
} from "./types";
import { ItemSprite } from "./item-sprite";
import { ItemToken } from "./item-token";
import { ItemTokenStack } from "./item-token-stack";
import { InventoryVisualLegend } from "./legend";
import { InventoryVisualCell, InventoryVisualPanel } from "./visual-panel";

const SAMPLE_COLORS: ItemColorFamily[] = ["amber", "green", "blue", "purple"];

export function InventoryVisualsDemo() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Inventory Visuals</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Sprite matrix for reviewing shape consistency, state clarity, and small-size legibility.
        </p>
      </header>

      <InventoryVisualLegend />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Sprite Kinds</h2>
        <InventoryVisualPanel className="grid grid-cols-[8rem_repeat(6,minmax(4.5rem,1fr))] gap-2 overflow-x-auto">
          <div className="text-xs font-medium text-muted-foreground">Kind</div>
          {ITEM_COLOR_FAMILIES.map((color) => (
            <div key={color} className="text-xs font-medium capitalize text-muted-foreground">
              {color}
            </div>
          ))}
          {ITEM_SPRITE_KINDS.map((kind) => (
            <div key={kind} className="contents">
              <div className="flex items-center text-sm font-medium capitalize">{kind}</div>
              {ITEM_COLOR_FAMILIES.map((color) => (
                <InventoryVisualCell key={`${kind}-${color}`} className="flex min-h-16 items-center justify-center">
                  <ItemSprite kind={kind} color={color} size="md" title={`${kind} ${color}`} />
                </InventoryVisualCell>
              ))}
            </div>
          ))}
        </InventoryVisualPanel>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Token States</h2>
        <InventoryVisualPanel className="grid grid-cols-[8rem_repeat(8,minmax(5rem,1fr))] gap-2 overflow-x-auto">
          <div className="text-xs font-medium text-muted-foreground">Kind</div>
          {ITEM_VISUAL_STATES.map((state) => (
            <div key={state} className="text-xs font-medium capitalize text-muted-foreground">
              {state}
            </div>
          ))}
          {ITEM_SPRITE_KINDS.map((kind, index) => {
            const color = SAMPLE_COLORS[index % SAMPLE_COLORS.length];
            return (
              <div key={kind} className="contents">
                <div className="flex items-center text-sm font-medium capitalize">{kind}</div>
                {ITEM_VISUAL_STATES.map((state) => (
                  <InventoryVisualCell key={`${kind}-${state}`} className="flex min-h-20 items-center justify-center">
                  <ItemToken
                    kind={kind}
                    color={color}
                      state={state === "selected" ? "available" : state}
                      selected={state === "selected"}
                    size="md"
                    quantity={state === "available" ? undefined : "12"}
                    lotCode={state === "available" ? undefined : "L-24"}
                      title={`${kind} ${state}`}
                    />
                  </InventoryVisualCell>
                ))}
              </div>
            );
          })}
        </InventoryVisualPanel>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Sizes</h2>
        <InventoryVisualPanel className="grid grid-cols-[8rem_repeat(4,minmax(7rem,1fr))] gap-2 overflow-x-auto">
          <div className="text-xs font-medium text-muted-foreground">Example</div>
          {ITEM_VISUAL_SIZES.map((size) => (
            <div key={size} className="text-xs font-medium uppercase text-muted-foreground">
              {size}
            </div>
          ))}
          {ITEM_SPRITE_KINDS.map((kind) => (
            <div key={kind} className="contents">
              <div className="flex items-center text-sm font-medium capitalize">{kind}</div>
              {ITEM_VISUAL_SIZES.map((size) => (
                <InventoryVisualCell key={`${kind}-${size}`} className="flex min-h-24 items-center justify-center">
                  <ItemToken
                    kind={kind}
                    color="blue"
                    state="available"
                    selected
                    size={size}
                    quantity="8"
                    lotCode="A-01"
                  />
                </InventoryVisualCell>
              ))}
            </div>
          ))}
        </InventoryVisualPanel>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Small State Stress</h2>
        <InventoryVisualPanel className="grid grid-cols-[8rem_repeat(6,minmax(4.5rem,1fr))] gap-2 overflow-x-auto">
          <div className="text-xs font-medium text-muted-foreground">Case</div>
          {(["available", "reserved", "inbound", "hold", "quarantine", "shortage"] as const).map((state) => (
            <div key={state} className="text-xs font-medium capitalize text-muted-foreground">
              {state}
            </div>
          ))}
          {(["box", "crate", "tote", "pallet", "roll", "drum"] as const).map((kind) => (
            <div key={kind} className="contents">
              <div className="flex items-center text-sm font-medium capitalize">{kind}</div>
              {(["available", "reserved", "inbound", "hold", "quarantine", "shortage"] as const).map((state) => (
                <InventoryVisualCell key={`${kind}-${state}`} className="flex min-h-16 items-center justify-center">
                  <ItemToken
                    kind={kind}
                    color={state === "shortage" ? "red" : "amber"}
                    state={state}
                    selected={state === "reserved"}
                    size="sm"
                    quantity={state === "available" ? undefined : "7"}
                  />
                </InventoryVisualCell>
              ))}
            </div>
          ))}
        </InventoryVisualPanel>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">State Stress Cases</h2>
        <InventoryVisualPanel className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ITEM_VISUAL_STATES.map((state) => (
            <InventoryVisualCell key={state} className="space-y-2 p-3">
              <div className="text-xs font-medium capitalize text-muted-foreground">
                Red item · {state}
              </div>
              <ItemToken
                kind="drum"
                color="red"
                state={state === "selected" ? "available" : state}
                selected={state === "selected"}
                size="md"
                quantity={state === "available" ? undefined : "12"}
                lotCode={state === "available" ? undefined : "R-01"}
              />
            </InventoryVisualCell>
          ))}
        </InventoryVisualPanel>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Stacks</h2>
        <InventoryVisualPanel className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InventoryVisualCell className="space-y-2 p-3">
            <div className="text-xs font-medium text-muted-foreground">Available stock</div>
            <ItemTokenStack count={3} kind="box" color="green" state="available" />
          </InventoryVisualCell>
          <InventoryVisualCell className="space-y-2 p-3">
            <div className="text-xs font-medium text-muted-foreground">Overflow</div>
            <ItemTokenStack count={9} maxVisible={4} kind="bag" color="amber" state="allocated" quantity="24" />
          </InventoryVisualCell>
          <InventoryVisualCell className="space-y-2 p-3">
            <div className="text-xs font-medium text-muted-foreground">Inbound</div>
            <ItemTokenStack count={6} maxVisible={3} kind="pallet" color="blue" state="inbound" />
          </InventoryVisualCell>
          <InventoryVisualCell className="space-y-2 p-3">
            <div className="text-xs font-medium text-muted-foreground">Shortage</div>
            <ItemTokenStack count={5} maxVisible={3} kind="drum" color="red" state="shortage" quantity="5" />
          </InventoryVisualCell>
        </InventoryVisualPanel>
      </section>
    </div>
  );
}
