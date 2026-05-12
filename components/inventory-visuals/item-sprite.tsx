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
    top: "#f7c45a",
    front: "#d9932d",
    side: "#b96f22",
    dark: "#744116",
    line: "#4a301c",
    light: "#ffe1a1",
    band: "#fff0c8",
  },
  green: {
    top: "#79d28a",
    front: "#3fae65",
    side: "#2f814d",
    dark: "#1e4c32",
    line: "#1d3327",
    light: "#c0f2c9",
    band: "#e2f8df",
  },
  blue: {
    top: "#7bbff5",
    front: "#408bd5",
    side: "#3168a4",
    dark: "#203f64",
    line: "#1f3147",
    light: "#cae8ff",
    band: "#e3f3ff",
  },
  slate: {
    top: "#a9b3c1",
    front: "#778496",
    side: "#586372",
    dark: "#323945",
    line: "#272d36",
    light: "#dbe2ea",
    band: "#f0f3f6",
  },
  purple: {
    top: "#b9a0f4",
    front: "#8364d9",
    side: "#6249a8",
    dark: "#3d2f68",
    line: "#2f2948",
    light: "#e5dcff",
    band: "#f0eaff",
  },
  red: {
    top: "#f28c86",
    front: "#d64d47",
    side: "#a33b37",
    dark: "#642826",
    line: "#462625",
    light: "#ffd2cf",
    band: "#ffe8e5",
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
  return (
    <g stroke={palette.line} strokeLinecap="round" strokeLinejoin="round">
      <path
        d={
          sack
            ? "M27 14 C31 18 35 18 39 14 L45 43 C42 52 24 52 21 43Z"
            : "M22 20 C26 15 40 15 44 20 L47 42 C43 51 23 51 19 42Z"
        }
        fill={palette.front}
        strokeWidth="2"
      />
      <path d={sack ? "M27 15 C31 19 35 19 39 15" : "M25 18 C30 22 36 22 41 18"} fill="none" stroke={palette.light} strokeWidth="2" />
      <path d="M24 28 C30 32 38 32 43 28" fill="none" stroke={palette.side} strokeWidth="2" opacity="0.55" />
      <path d="M27 39 C32 42 38 41 42 37" fill="none" stroke={palette.light} strokeWidth="2" opacity="0.7" />
      {sack ? (
        <>
          <path d="M25 22 23 47" fill="none" stroke={palette.dark} strokeWidth="1.7" opacity="0.42" />
          <path d="M40 23 42 46" fill="none" stroke={palette.dark} strokeWidth="1.7" opacity="0.35" />
          <path d="M29 18 25 21" fill="none" stroke={palette.line} strokeWidth="1.5" />
          <path d="M37 18 41 21" fill="none" stroke={palette.line} strokeWidth="1.5" />
        </>
      ) : (
        <path d="M34 22 34 48" fill="none" stroke={palette.dark} strokeWidth="1.5" opacity="0.35" />
      )}
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
      <path d="M25 22 47 30 41 46 19 38Z" fill={palette.front} strokeWidth="2" />
      <ellipse cx="25" cy="30" rx="9" ry="12" transform="rotate(18 25 30)" fill={palette.top} strokeWidth="2.2" />
      <ellipse cx="25" cy="30" rx="4" ry="5.7" transform="rotate(18 25 30)" fill={palette.band} strokeWidth="2" />
      <path d="M34 25 28 42" fill="none" stroke={palette.light} strokeWidth="2.2" opacity="0.85" />
      <path d="M42 28 36 45" fill="none" stroke={palette.side} strokeWidth="2.2" opacity="0.75" />
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
    case "bag":
      return <Bag palette={palette} />;
    case "box":
      return <IsoBox palette={palette} />;
    case "crate":
      return <IsoBox palette={palette} crate />;
    case "tote":
      return <IsoBox palette={palette} open />;
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
      className={cn("shrink-0 overflow-visible text-foreground", SPRITE_SIZE_CLASS[size], className)}
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
