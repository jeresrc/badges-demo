"use client";

import { BoxedPin } from "./BoxedPin";
import { FlowerMedal } from "./FlowerMedal";
import { HexBadge } from "./HexBadge";
import { Medallion } from "./Medallion";
import { Packaged } from "./Packaged";
import { WarMedal } from "./WarMedal";
import type { MetalKind } from "./materials";

export const BADGE_VARIANTS = [
  "medallion",
  "hex",
  "warMedal",
  "flowerMedal",
  "packaged",
  "boxed",
] as const;
export type BadgeVariant = (typeof BADGE_VARIANTS)[number];

/** Signature look of each variant — the enamel colour seeds the Leva picker. */
export const BADGE_PRESETS: Record<BadgeVariant, { metal: MetalKind; enamelColor: string }> = {
  medallion: { metal: "gold", enamelColor: "#e85410" },
  hex: { metal: "chrome", enamelColor: "#ff5a00" },
  warMedal: { metal: "chrome", enamelColor: "#ff7519" },
  flowerMedal: { metal: "gold", enamelColor: "#ff4a1c" },
  packaged: { metal: "gold", enamelColor: "#d8341f" },
  boxed: { metal: "gold", enamelColor: "#b81f3d" },
};

export function Badge({ variant }: { variant: BadgeVariant }) {
  switch (variant) {
    case "hex":
      return <HexBadge />;
    case "warMedal":
      return <WarMedal />;
    case "flowerMedal":
      return <FlowerMedal />;
    case "packaged":
      return <Packaged />;
    case "boxed":
      return <BoxedPin />;
    case "medallion":
    default:
      return <Medallion />;
  }
}

export { BoxedPin, FlowerMedal, HexBadge, Medallion, Packaged, WarMedal };
