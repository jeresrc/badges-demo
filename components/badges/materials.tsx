"use client";

import { createContext, useContext, useMemo } from "react";
import { Color } from "three";
import type { ColorRepresentation } from "three";

export type MetalKind = "gold" | "chrome" | "silver" | "brass";

/**
 * Base reflectance colours for the rims. With `metalness = 1` the albedo *is*
 * the F0 reflectance, so these are tuned around real measured metal values and
 * then nudged a little brighter for product-shot punch.
 */
const METAL_COLOR: Record<MetalKind, string> = {
  gold: "#ffc85c",
  chrome: "#cdd2d8",
  silver: "#efece4",
  brass: "#d9b063",
};

/** Per-metal roughness multiplier: brass reads softer, chrome mirror-sharp. */
const METAL_ROUGHNESS_SCALE: Record<MetalKind, number> = {
  gold: 1,
  chrome: 0.6,
  silver: 0.85,
  brass: 1.5,
};

export type PinMaterialSettings = {
  enamelColor: string;
  enamelRoughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  metalRoughness: number;
  metalness: number;
  envMapIntensity: number;
};

export const DEFAULT_PIN_MATERIALS: PinMaterialSettings = {
  enamelColor: "#c9420f",
  enamelRoughness: 0.22,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  metalRoughness: 0.12,
  metalness: 1,
  envMapIntensity: 1.35,
};

const PinMaterialContext = createContext<PinMaterialSettings>(DEFAULT_PIN_MATERIALS);

export function PinMaterialProvider({
  value,
  children,
}: {
  value: PinMaterialSettings;
  children: React.ReactNode;
}) {
  return <PinMaterialContext.Provider value={value}>{children}</PinMaterialContext.Provider>;
}

export function usePinMaterials(): PinMaterialSettings {
  return useContext(PinMaterialContext);
}

/** Polished die-struck metal. */
export function MetalMaterial({ metal }: { metal: MetalKind }) {
  const { metalness, metalRoughness, envMapIntensity } = usePinMaterials();

  return (
    <meshStandardMaterial
      color={METAL_COLOR[metal]}
      metalness={metalness}
      roughness={Math.min(1, Math.max(0.02, metalRoughness * METAL_ROUGHNESS_SCALE[metal]))}
      envMapIntensity={envMapIntensity}
    />
  );
}

/**
 * Hard enamel: an opaque pigmented body under a glassy fired-in coat. The
 * clearcoat lobe is what separates enamel from plastic — the body stays
 * moderately rough while the coat gives a tight, near-mirror highlight.
 */
export function EnamelMaterial({ color }: { color: ColorRepresentation }) {
  const { enamelRoughness, clearcoat, clearcoatRoughness, envMapIntensity } = usePinMaterials();

  return (
    <meshPhysicalMaterial
      color={color}
      metalness={0}
      roughness={enamelRoughness}
      clearcoat={clearcoat}
      clearcoatRoughness={clearcoatRoughness}
      reflectivity={0.55}
      ior={1.52}
      specularIntensity={1}
      envMapIntensity={envMapIntensity}
    />
  );
}

/** Derives a companion enamel tone from the active colour (two-tone fields). */
export function useShiftedColor(base: string, hue: number, saturation: number, lightness: number) {
  return useMemo(() => new Color(base).offsetHSL(hue, saturation, lightness), [
    base,
    hue,
    saturation,
    lightness,
  ]);
}
