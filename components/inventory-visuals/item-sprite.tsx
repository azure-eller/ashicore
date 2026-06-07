import * as React from "react";

import { cn } from "@/lib/utils";
import type {
  ItemColorFamily,
  ItemSpriteKind,
  ItemVisualSize,
} from "./types";

type ItemSpriteProps = Omit<React.ComponentProps<"svg">, "color"> & {
  kind?: ItemSpriteKind;
  color?: ItemColorFamily;
  size?: ItemVisualSize;
  title?: string;
};

type Palette = {
  top: string;
  front: string;
  side: string;
  dark: string;
  line: string;
  light: string;
  band: string;
};

const SPRITE_SIZE_CLASS: Record<ItemVisualSize, string> = {
  xs: "size-7",
  sm: "size-9",
  md: "size-12",
  lg: "size-16",
};

const PALETTES: Record<ItemColorFamily, Palette> = {
  amber: {
    top: "var(--color-warning)",
    front: "color-mix(in oklch, var(--color-warning), var(--status-warning-ink) 22%)",
    side: "color-mix(in oklch, var(--color-warning), var(--status-warning-ink) 38%)",
    dark: "var(--status-warning-ink)",
    line: "color-mix(in oklch, var(--status-warning-ink), var(--color-ink) 45%)",
    light: "color-mix(in oklch, var(--color-warning), var(--color-surface) 42%)",
    band: "var(--color-warning-soft)",
  },
  green: {
    top: "var(--color-success)",
    front: "color-mix(in oklch, var(--color-success), var(--status-success-ink) 20%)",
    side: "color-mix(in oklch, var(--color-success), var(--status-success-ink) 36%)",
    dark: "var(--status-success-ink)",
    line: "color-mix(in oklch, var(--status-success-ink), var(--color-ink) 40%)",
    light: "color-mix(in oklch, var(--color-success), var(--color-surface) 48%)",
    band: "var(--color-success-soft)",
  },
  blue: {
    top: "var(--color-info)",
    front: "color-mix(in oklch, var(--color-info), var(--color-ink) 20%)",
    side: "color-mix(in oklch, var(--color-info), var(--color-ink) 36%)",
    dark: "color-mix(in oklch, var(--color-info), var(--color-ink) 46%)",
    line: "color-mix(in oklch, var(--color-info), var(--color-ink) 62%)",
    light: "color-mix(in oklch, var(--color-info), var(--color-surface) 50%)",
    band: "var(--color-info-soft)",
  },
  slate: {
    top: "var(--color-ink-faint)",
    front: "color-mix(in oklch, var(--color-ink-faint), var(--color-ink) 18%)",
    side: "color-mix(in oklch, var(--color-ink-faint), var(--color-ink) 34%)",
    dark: "var(--color-ink-soft)",
    line: "color-mix(in oklch, var(--color-ink), var(--color-surface) 24%)",
    light: "color-mix(in oklch, var(--color-ink-faint), var(--color-surface) 62%)",
    band: "var(--color-surface-alt)",
  },
  purple: {
    top: "color-mix(in oklch, var(--color-info), var(--color-accent) 32%)",
    front: "color-mix(in oklch, var(--color-info), var(--color-ink) 34%)",
    side: "color-mix(in oklch, var(--color-info), var(--color-ink) 48%)",
    dark: "color-mix(in oklch, var(--color-info), var(--color-ink) 62%)",
    line: "color-mix(in oklch, var(--color-info), var(--color-ink) 72%)",
    light: "color-mix(in oklch, var(--color-info-soft), var(--color-accent-soft) 40%)",
    band: "color-mix(in oklch, var(--color-info-soft), var(--color-accent-soft) 62%)",
  },
  red: {
    top: "var(--color-danger)",
    front: "color-mix(in oklch, var(--color-danger), var(--status-danger-ink) 20%)",
    side: "color-mix(in oklch, var(--color-danger), var(--status-danger-ink) 36%)",
    dark: "var(--status-danger-ink)",
    line: "color-mix(in oklch, var(--status-danger-ink), var(--color-ink) 42%)",
    light: "color-mix(in oklch, var(--color-danger), var(--color-surface) 48%)",
    band: "var(--color-danger-soft)",
  },
};

function BaseShadow() {
  return (
    <ellipse
      cx="33"
      cy="52"
      rx="21"
      ry="6"
      fill="currentColor"
      opacity="0.14"
    />
  );
}

function IsoBox({
  palette,
  crate = false,
  open = false,
}: {
  palette: Palette;
  crate?: boolean;
  open?: boolean;
}) {
  return (
    <g stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 20 33 12 51 21 34 30Z" fill={open ? palette.dark : palette.top} />
      <path d="M17 20 34 30 34 50 17 39Z" fill={palette.front} />
      <path d="M34 30 51 21 51 41 34 50Z" fill={palette.side} />
      <path d="M17 20 33 12 51 21 34 30Z" fill="none" strokeWidth="2" />
      <path d="M17 20 17 39 34 50 51 41 51 21" fill="none" strokeWidth="2" />
      {open ? (
        <>
          <path d="M22 22 34 28 46 22" fill="none" stroke={palette.light} strokeWidth="2" />
          <path d="M24 25 34 30 44 25" fill="none" stroke={palette.line} strokeWidth="1.5" opacity="0.45" />
        </>
      ) : (
        <path d="M25 16 42 25" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.85" />
      )}
      {crate ? (
        <>
          <path d="M21 24 30 29 30 45 21 39Z" fill="none" stroke={palette.dark} strokeWidth="2" opacity="0.55" />
          <path d="M38 31 47 26 47 39 38 44Z" fill="none" stroke={palette.dark} strokeWidth="2" opacity="0.55" />
          <path d="M19 34 32 42" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.65" />
          <path d="M37 40 50 33" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.55" />
          <path d="M25 18 42 27" fill="none" stroke={palette.dark} strokeWidth="2" opacity="0.45" />
        </>
      ) : null}
    </g>
  );
}

function Pallet({ palette }: { palette: Palette }) {
  return (
    <g stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 31 32 22 53 32 34 43Z" fill={palette.top} strokeWidth="2" />
      <path d="M14 31 34 43 34 51 14 39Z" fill={palette.front} strokeWidth="2" />
      <path d="M34 43 53 32 53 40 34 51Z" fill={palette.side} strokeWidth="2" />
      <path d="M18 33 36 24" fill="none" stroke={palette.light} strokeWidth="3" />
      <path d="M26 38 45 28" fill="none" stroke={palette.light} strokeWidth="3" />
      <path d="M14 36 34 48 53 37" fill="none" stroke={palette.dark} strokeWidth="2" opacity="0.65" />
      <path d="M20 39 20 48" fill="none" stroke={palette.line} strokeWidth="3" />
      <path d="M34 51 34 42" fill="none" stroke={palette.line} strokeWidth="3" />
      <path d="M47 44 47 35" fill="none" stroke={palette.line} strokeWidth="3" />
    </g>
  );
}

function Drum({ palette }: { palette: Palette }) {
  return (
    <g stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 20 C21 14 45 14 45 20 L45 43 C45 49 21 49 21 43Z" fill={palette.front} strokeWidth="2" />
      <ellipse cx="33" cy="20" rx="12" ry="6" fill={palette.top} strokeWidth="2" />
      <path d="M21 31 C21 37 45 37 45 31" fill="none" stroke={palette.dark} strokeWidth="2" opacity="0.5" />
      <path d="M21 41 C21 47 45 47 45 41" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.75" />
      <path d="M27 18 C30 16 37 16 40 18" fill="none" stroke={palette.light} strokeWidth="2" />
      <path d="M25 25 41 25" fill="none" stroke={palette.band} strokeWidth="3" opacity="0.75" />
    </g>
  );
}

function Bucket({ palette }: { palette: Palette }) {
  return (
    <g stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 25 45 25 41 47 C38 51 28 51 25 47Z" fill={palette.front} strokeWidth="2" />
      <ellipse cx="33" cy="25" rx="12" ry="5" fill={palette.top} strokeWidth="2" />
      <path d="M23 27 C23 17 43 17 43 27" fill="none" stroke={palette.dark} strokeWidth="2" />
      <path d="M28 30 39 30" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.85" />
      <path d="M26 42 C30 45 36 45 40 42" fill="none" stroke={palette.side} strokeWidth="2" />
    </g>
  );
}

function Bag({ palette, sack = false }: { palette: Palette; sack?: boolean }) {
  if (!sack) {
    return (
      <g stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16 43 16 47 46 C43 51 24 51 20 46Z" fill={palette.front} strokeWidth="2" />
        <path d="M22 16 43 16 46 24 C40 28 27 28 21 24Z" fill={palette.top} strokeWidth="2" />
        <path d="M21 24 C27 28 40 28 46 24" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.85" />
        <path d="M24 19 41 19" fill="none" stroke={palette.band} strokeWidth="2.5" opacity="0.85" />
        <path d="M25 30 43 30 41 43 27 43Z" fill={palette.band} strokeWidth="1.8" opacity="0.92" />
        <path d="M28 34 40 34" fill="none" stroke={palette.dark} strokeWidth="1.8" opacity="0.55" />
        <path d="M29 38 38 38" fill="none" stroke={palette.dark} strokeWidth="1.5" opacity="0.45" />
        <path d="M24 26 22 45" fill="none" stroke={palette.dark} strokeWidth="1.7" opacity="0.35" />
        <path d="M43 26 45 45" fill="none" stroke={palette.dark} strokeWidth="1.7" opacity="0.35" />
        <path d="M25 46 C31 49 38 49 43 46" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.65" />
        <circle cx="31" cy="35" r="1.1" fill={palette.dark} stroke="none" opacity="0.5" />
        <circle cx="36" cy="37" r="1" fill={palette.dark} stroke="none" opacity="0.42" />
      </g>
    );
  }

  return (
    <g stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M27 14 C31 18 35 18 39 14 L45 43 C42 52 24 52 21 43Z"
        fill={palette.front}
        strokeWidth="2"
      />
      <path d="M27 15 C31 19 35 19 39 15" fill="none" stroke={palette.light} strokeWidth="2" />
      <path d="M24 28 C30 32 38 32 43 28" fill="none" stroke={palette.side} strokeWidth="2" opacity="0.55" />
      <path d="M27 39 C32 42 38 41 42 37" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.7" />
      <path d="M25 22 23 47" fill="none" stroke={palette.dark} strokeWidth="1.7" opacity="0.42" />
      <path d="M40 23 42 46" fill="none" stroke={palette.dark} strokeWidth="1.7" opacity="0.35" />
      <path d="M29 18 25 21" fill="none" stroke={palette.line} strokeWidth="1.5" />
      <path d="M37 18 41 21" fill="none" stroke={palette.line} strokeWidth="1.5" />
    </g>
  );
}

function BagOneCubicFoot({ palette }: { palette: Palette }) {
  return (
    <g transform="translate(3 3) scale(0.9)" stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 18 H47 C45 28 45 38 47 48 H19 C21 38 21 28 19 18Z" fill={palette.front} strokeWidth="2" />
      <path d="M22 22 H44" fill="none" stroke={palette.light} strokeWidth="2.2" opacity="0.85" />
      <path d="M23 25 H43" fill="none" stroke={palette.dark} strokeWidth="1.5" opacity="0.35" />
      <path d="M20 47 H46" fill="none" stroke={palette.light} strokeWidth="1.8" opacity="0.45" />
      <path d="M20 24 C21 31 21 36 20 43" fill="none" stroke={palette.dark} strokeWidth="1.5" opacity="0.25" />
      <path d="M46 24 C45 31 45 36 46 43" fill="none" stroke={palette.dark} strokeWidth="1.5" opacity="0.25" />
      <path d="M23 28 44 28 43 42 24 42Z" fill={palette.band} strokeWidth="1.8" opacity="0.96" />
      <path d="M27 32 40 32" fill="none" stroke={palette.dark} strokeWidth="1.6" opacity="0.52" />
      <path d="M28 37 38 37" fill="none" stroke={palette.dark} strokeWidth="1.4" opacity="0.42" />
    </g>
  );
}

function BagTwoCubicFoot({ palette }: { palette: Palette }) {
  return (
    <g transform="translate(-4 -5) scale(1.18)">
      <Bag palette={palette} />
    </g>
  );
}

function Tote({ palette }: { palette: Palette }) {
  return (
    <g stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 21 33 13 50 22 34 31Z" fill={palette.dark} strokeWidth="2" />
      <path d="M18 21 34 31 34 51 18 41Z" fill={palette.front} strokeWidth="2" />
      <path d="M34 31 50 22 50 42 34 51Z" fill={palette.side} strokeWidth="2" />
      <path d="M22 23 33 18 45 23 34 29Z" fill={palette.top} stroke="none" opacity="0.65" />
      <path d="M22 25 34 32 46 25" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.78" />
      <path d="M21 28 31 34 31 47 21 41Z" fill="none" stroke={palette.dark} strokeWidth="1.8" opacity="0.45" />
      <path d="M38 34 47 29 47 41 38 46Z" fill="none" stroke={palette.dark} strokeWidth="1.8" opacity="0.42" />
      <path d="M19 34 34 43 50 34" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.45" />
      <path d="M18 21 C17 15 23 13 26 18" fill="none" stroke={palette.line} strokeWidth="2.6" />
      <path d="M32 14 C35 8 42 11 43 18" fill="none" stroke={palette.line} strokeWidth="2.6" />
      <path d="M50 22 C52 16 47 13 43 19" fill="none" stroke={palette.line} strokeWidth="2.6" />
      <path d="M34 31 C37 25 43 25 46 29" fill="none" stroke={palette.line} strokeWidth="2.6" />
      <path d="M20 21 C20 18 23 17 25 19" fill="none" stroke={palette.light} strokeWidth="1.5" opacity="0.82" />
      <path d="M35 15 C37 13 40 15 41 18" fill="none" stroke={palette.light} strokeWidth="1.5" opacity="0.82" />
      <path d="M48 22 C49 19 46 18 44 19" fill="none" stroke={palette.light} strokeWidth="1.5" opacity="0.78" />
      <path d="M37 30 C39 28 43 28 45 29" fill="none" stroke={palette.light} strokeWidth="1.5" opacity="0.78" />
    </g>
  );
}

function Bulk({ palette }: { palette: Palette }) {
  return (
    <g stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 42 C20 28 27 24 34 23 C42 24 49 31 53 42 C45 51 24 52 15 42Z" fill={palette.front} strokeWidth="2" />
      <path d="M20 40 C26 33 31 30 38 29 C43 31 47 35 50 40" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.8" />
      <path d="M24 45 C30 48 41 47 47 43" fill="none" stroke={palette.side} strokeWidth="2" />
      <circle cx="30" cy="35" r="1.4" fill={palette.dark} stroke="none" opacity="0.55" />
      <circle cx="38" cy="37" r="1.2" fill={palette.dark} stroke="none" opacity="0.45" />
      <circle cx="34" cy="30" r="1" fill={palette.band} stroke="none" opacity="0.9" />
    </g>
  );
}

function Roll({ palette }: { palette: Palette }) {
  return (
    <g stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 31 47 23 52 40 22 48Z" fill={palette.front} strokeWidth="2" />
      <ellipse cx="18" cy="39.5" rx="6.5" ry="9" transform="rotate(-15 18 39.5)" fill={palette.top} strokeWidth="2" />
      <ellipse cx="48" cy="31.5" rx="6.5" ry="9" transform="rotate(-15 48 31.5)" fill={palette.side} strokeWidth="2" />
      <ellipse cx="18" cy="39.5" rx="2.4" ry="3.6" transform="rotate(-15 18 39.5)" fill={palette.band} strokeWidth="1.8" />
      <ellipse cx="48" cy="31.5" rx="2.4" ry="3.6" transform="rotate(-15 48 31.5)" fill={palette.band} strokeWidth="1.8" />
      <path d="M11 41 17 39.5" fill="none" stroke={palette.line} strokeWidth="2.2" />
      <path d="M49 31.5 56 29.5" fill="none" stroke={palette.line} strokeWidth="2.2" />
      <path d="M27 28 32 45" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.8" />
      <path d="M38 25 43 42" fill="none" stroke={palette.dark} strokeWidth="2" opacity="0.35" />
    </g>
  );
}

function Generic({ palette }: { palette: Palette }) {
  return (
    <g stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 28 33 17 48 28 34 48Z" fill={palette.front} strokeWidth="2" />
      <path d="M19 28 33 17 34 48Z" fill={palette.top} strokeWidth="2" opacity="0.95" />
      <path d="M33 17 48 28 34 48Z" fill={palette.side} strokeWidth="2" opacity="0.95" />
      <path d="M26 27 39 27" fill="none" stroke={palette.light} strokeWidth="2" />
      <path d="M30 34 36 34" fill="none" stroke={palette.band} strokeWidth="2" />
    </g>
  );
}

function SpriteObject({
  kind,
  palette,
}: {
  kind: ItemSpriteKind;
  palette: Palette;
}) {
  switch (kind) {
    case "bag-1cf":
      return <BagOneCubicFoot palette={palette} />;
    case "bag-2cf":
      return <BagTwoCubicFoot palette={palette} />;
    case "bag":
      return <Bag palette={palette} />;
    case "box":
      return <IsoBox palette={palette} />;
    case "crate":
      return <IsoBox palette={palette} crate />;
    case "tote":
      return <Tote palette={palette} />;
    case "pallet":
      return <Pallet palette={palette} />;
    case "drum":
      return <Drum palette={palette} />;
    case "bucket":
      return <Bucket palette={palette} />;
    case "sack":
      return <Bag palette={palette} sack />;
    case "bulk":
      return <Bulk palette={palette} />;
    case "roll":
      return <Roll palette={palette} />;
    case "generic":
      return <Generic palette={palette} />;
  }
}

export function ItemSprite({
  kind = "generic",
  color = "slate",
  size = "md",
  title,
  className,
  ...props
}: ItemSpriteProps) {
  const labelled = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };

  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("shrink-0 overflow-visible text-[var(--color-ink)]", SPRITE_SIZE_CLASS[size], className)}
      {...labelled}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <BaseShadow />
      <SpriteObject kind={kind} palette={PALETTES[color]} />
    </svg>
  );
}

export { PALETTES as itemSpritePalettes, SPRITE_SIZE_CLASS as itemSpriteSizeClass };
