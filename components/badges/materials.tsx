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
  chrome: "#e3e7ec",
  silver: "#efece4",
  brass: "#d9b063",
};

/** Per-metal roughness multiplier: brass reads softer, chrome mirror-sharp. */
const METAL_ROUGHNESS_SCALE: Record<MetalKind, number> = {
  gold: 1,
  chrome: 0.2,
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
export function EnamelMaterial({
  color,
  vertexColors = false,
}: {
  color: ColorRepresentation;
  /** Multiply per-vertex tints into the body colour (tonal gradients). */
  vertexColors?: boolean;
}) {
  const { enamelRoughness, clearcoat, clearcoatRoughness, envMapIntensity } = usePinMaterials();

  return (
    <meshPhysicalMaterial
      color={color}
      vertexColors={vertexColors}
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

/**
 * Candy-glass enamel: deep, wet, slightly translucent — reads like hard candy
 * or coloured glass rather than opaque paint. Transmission lets light dive into
 * the body and bounce off the metal back plate behind it, which is what gives
 * the "juicy" depth; attenuation keeps the colour saturated instead of washing
 * out to clear.
 */
export function CandyEnamelMaterial({
  color,
  vertexColors = false,
  attenuationColor,
  attenuationDistance = 0.25,
  thickness = 0.6,
  emissive,
  emissiveIntensity = 0,
}: {
  color: ColorRepresentation;
  /** Multiply per-vertex tints into the body colour (tonal gradients). */
  vertexColors?: boolean;
  /** Colour the light shifts toward as it travels through the body. */
  attenuationColor?: ColorRepresentation;
  attenuationDistance?: number;
  thickness?: number;
  /** Faint self-glow for enamel that reads overexposed in the reference shot. */
  emissive?: ColorRepresentation;
  emissiveIntensity?: number;
}) {
  const { enamelRoughness, clearcoat, clearcoatRoughness, envMapIntensity } = usePinMaterials();

  return (
    <meshPhysicalMaterial
      color={color}
      vertexColors={vertexColors}
      metalness={0}
      roughness={Math.min(enamelRoughness, 0.06)}
      transmission={0.55}
      thickness={thickness}
      ior={1.45}
      attenuationColor={attenuationColor ?? color}
      attenuationDistance={attenuationDistance}
      emissive={emissive ?? "#000000"}
      emissiveIntensity={emissiveIntensity}
      clearcoat={clearcoat}
      clearcoatRoughness={clearcoatRoughness}
      envMapIntensity={envMapIntensity}
    />
  );
}

/**
 * Piano-black lacquer for presentation boxes. The body must stay BLACK: a
 * near-black albedo with a *sharp* glassy coat (low roughness) so the studio
 * panels draw crisp white edges instead of a broad grey sheen, and the env
 * contribution cut down so glancing Fresnel never lifts the body to grey.
 */
export function LacquerMaterial({ color = "#050506" }: { color?: ColorRepresentation }) {
  const { envMapIntensity } = usePinMaterials();

  return (
    <meshPhysicalMaterial
      color={color}
      metalness={0}
      roughness={0.16}
      clearcoat={1}
      clearcoatRoughness={0.05}
      envMapIntensity={envMapIntensity * 0.4}
    />
  );
}

/** Light-drinking velvet insert: matte black body with the faintest grazing
 * sheen so the floor reads as fabric rather than a hole in the render. */
export function VelvetMaterial() {
  return (
    <meshPhysicalMaterial
      color="#0a0a0d"
      metalness={0}
      roughness={1}
      sheen={0.5}
      sheenRoughness={0.85}
      sheenColor="#16161c"
      envMapIntensity={0.3}
    />
  );
}

/** Uncoated card stock: flat, light-drinking, zero specular story. */
export function PaperMaterial({ color }: { color: ColorRepresentation }) {
  return <meshStandardMaterial color={color} metalness={0} roughness={0.92} />;
}

/**
 * Thin vacuum-formed blister film. Transmission ~1 so the charm inside stays
 * visible; the crinkled geometry supplies the specular interest, the material
 * just has to be glassy and thin.
 */
export function FilmMaterial() {
  const { envMapIntensity } = usePinMaterials();

  return (
    <meshPhysicalMaterial
      color="#ffffff"
      metalness={0}
      roughness={0.11}
      transmission={1}
      thickness={0.02}
      ior={1.4}
      clearcoat={0.3}
      clearcoatRoughness={0.12}
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
