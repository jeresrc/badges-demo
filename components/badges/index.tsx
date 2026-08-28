"use client";

import { CirclePin } from "./CirclePin";
import { HexPin } from "./HexPin";
import { OvalPin } from "./OvalPin";
import { ShieldPin } from "./ShieldPin";
import type { MetalKind } from "./materials";

export const BADGE_VARIANTS = ["circle", "hex", "shield", "oval"] as const;
export type BadgeVariant = (typeof BADGE_VARIANTS)[number];

/** Signature look of each pin — the enamel colour seeds the Leva colour picker. */
export const BADGE_PRESETS: Record<BadgeVariant, { metal: MetalKind; enamelColor: string }> = {
  circle: { metal: "gold", enamelColor: "#b8360d" },
  hex: { metal: "chrome", enamelColor: "#0fa39a" },
  shield: { metal: "brass", enamelColor: "#16305c" },
  oval: { metal: "silver", enamelColor: "#141a2e" },
};

export function Badge({ variant }: { variant: BadgeVariant }) {
  switch (variant) {
    case "hex":
      return <HexPin />;
    case "shield":
      return <ShieldPin />;
    case "oval":
      return <OvalPin />;
    case "circle":
    default:
      return <CirclePin />;
  }
}

export { CirclePin, HexPin, OvalPin, ShieldPin };
