"use client";

import { Environment, Lightformer } from "@react-three/drei";
import type { BadgeVariant } from "./badges";

/**
 * Per-badge tuning of the rig. The default is the neutral product-shot setup
 * every badge was built under; a variant can re-balance it (never restructure
 * it) so that its reference photograph's lighting read can be matched without
 * touching how the other badges look.
 */
type Rig = {
  /** Tint, position and relative strength of the key spot. */
  keyColor: string;
  keyPosition: [number, number, number];
  keyScale: number;
  /** Colour and relative strength of the second, opposing spot. */
  fillColor: string;
  fillScale: number;
  /** Narrow strip catching the right edge. */
  rightStripColor: string;
  rightStripIntensity: number;
  /** Fill panel on the shadow side of the rim. */
  fillPanelColor: string;
  /** Huge dim card on the camera axis — lifts flat camera-facing metal. */
  frontalCardColor: string;
  frontalCardIntensity: number;
  /** Tight "camera softbox" — the highlight in camera-facing gold and chrome. */
  softboxColor: string;
  softboxIntensity: number;
  /** Warm kicker behind the subject. */
  kickerIntensity: number;
};

const DEFAULT_RIG: Rig = {
  keyColor: "#fff3e4",
  keyPosition: [4.5, 5, 6.5],
  keyScale: 1,
  fillColor: "#8fb2ff",
  fillScale: 0.35,
  rightStripColor: "#bcd4ff",
  rightStripIntensity: 4.5,
  fillPanelColor: "#fff0dd",
  frontalCardColor: "#e8eeff",
  frontalCardIntensity: 0.45,
  softboxColor: "#fff6e8",
  softboxIntensity: 5,
  kickerIntensity: 4,
};

/* The flower medal reference is lit warm all round by a key from the upper
 * left: every stroke and petal carries one glint on its upper-left edge and
 * falls dark to the lower right, flat gold reads mid-tan, and the glow is
 * amber. So the blue sources go warm, the key spot moves to the upper left,
 * the right-hand strip is dimmed, and the frontal cards are eased back. */
const CLOISONNE_RIG: Partial<Rig> = {
  keyColor: "#fff3e4",
  keyPosition: [-4.5, 5.5, 6],
  keyScale: 0.8,
  fillColor: "#ffd9b0",
  fillScale: 0.25,
  rightStripColor: "#ffe9d2",
  rightStripIntensity: 1.5,
  fillPanelColor: "#fff0dd",
  frontalCardColor: "#fff6ec",
  frontalCardIntensity: 0.26,
  softboxColor: "#fff8f0",
  softboxIntensity: 2.2,
  kickerIntensity: 5,
};

const RIGS: Partial<Record<BadgeVariant, Partial<Rig>>> = {
  flowerMedal: CLOISONNE_RIG,
  /* HUEVOS is built from the same cloisonné parts and has to sit next to the
   * flower medal as a sibling, so it is lit by the identical rig. */
  huevosBadge: CLOISONNE_RIG,
};

/** Per-badge post-processing overrides (the Leva values apply otherwise). */
export type PostOverrides = { bloomIntensity?: number; bloomThreshold?: number };

/* The reference glows: every gold glint and the hot field carry a soft amber
 * halo, so bloom starts lower and pushes harder for the cloisonné pins. */
const CLOISONNE_BLOOM: PostOverrides = { bloomIntensity: 0.85, bloomThreshold: 0.88 };

export const POST_OVERRIDES: Partial<Record<BadgeVariant, PostOverrides>> = {
  flowerMedal: CLOISONNE_BLOOM,
  huevosBadge: CLOISONNE_BLOOM,
};

/**
 * Product-photography lighting rig.
 *
 * The reflections that sell polished metal come from the environment, not from
 * point lights, so the rig is a set of emissive Lightformer panels baked into a
 * small cube map: a big key softbox, a cool fill, an overhead strip and two
 * kickers behind the subject that draw bright edges along the rims. The map is
 * never used as a background, so the page stays pure black — you only ever see
 * the panels as reflections in the metal and in the enamel's clearcoat.
 *
 * Two real spot lights sit on top of that to give directional, controllable
 * shading and shadows across the recessed enamel.
 */
export function Studio({ spotIntensity, variant }: { spotIntensity: number; variant?: BadgeVariant }) {
  const rig: Rig = { ...DEFAULT_RIG, ...(variant ? RIGS[variant] : undefined) };

  return (
    <>
      <ambientLight intensity={0.03} />

      <spotLight
        position={rig.keyPosition}
        angle={0.5}
        penumbra={0.9}
        intensity={spotIntensity * rig.keyScale}
        color={rig.keyColor}
      />
      <spotLight
        position={[-5.5, -2.5, 4]}
        angle={0.6}
        penumbra={1}
        intensity={spotIntensity * rig.fillScale}
        color={rig.fillColor}
      />

      {/* Panels are deliberately narrow with wide black gaps between them: the
          gaps are what give polished metal its dark-to-mirror contrast. The
          Environment is keyed by variant so the cube map is re-baked when the
          rig changes (frames={1} bakes once per mount). */}
      <Environment key={variant ?? "default"} resolution={512} frames={1}>
        {/* Key softbox, upper left. */}
        <Lightformer form="rect" intensity={14} scale={[2.8, 2.8, 1]} position={[-4, 3, 4]} color="#ffffff" />
        {/* Long overhead strip — the highlight that sweeps across the rim. */}
        <Lightformer form="rect" intensity={8} scale={[9, 0.7, 1]} position={[0, 4.5, 1.5]} color="#ffffff" />
        {/* Narrow strip catching the right edge. */}
        <Lightformer
          form="rect"
          intensity={rig.rightStripIntensity}
          scale={[0.8, 5, 1]}
          position={[5, 0, 2.5]}
          color={rig.rightStripColor}
        />
        {/* Fill panel keeping the shadow side of the rim off pure black. */}
        <Lightformer form="rect" intensity={5} scale={[1.2, 3.5, 1]} position={[3.5, 1.5, 3.5]} color={rig.fillPanelColor} />
        {/* Narrow warm strip catching the left edge. */}
        <Lightformer form="rect" intensity={3.5} scale={[0.7, 4, 1]} position={[-5.5, -1, 1]} color="#ffd0a0" />
        {/* Big frontal fill card on the camera axis. Without it every surface
            that faces the lens — flat star emblems, camera-facing metal —
            reflects only the black room and reads as a silhouette. Dim and
            huge: it lifts frontal metal without flattening the contrast. */}
        <Lightformer
          form="rect"
          intensity={rig.frontalCardIntensity}
          scale={[16, 16, 1]}
          position={[0, 0.5, 7]}
          color={rig.frontalCardColor}
        />
        {/* Tight frontal card — the "camera softbox" reflection that actually
            reads as a highlight in camera-facing gold and chrome. */}
        <Lightformer
          form="rect"
          intensity={rig.softboxIntensity}
          scale={[2.2, 1.3, 1]}
          position={[0.8, 2, 5.5]}
          color={rig.softboxColor}
        />
        {/* Warm kicker behind the subject, seen in the rim's outer bevel. */}
        <Lightformer form="ring" intensity={rig.kickerIntensity} scale={3} position={[3, 2, -5]} color="#ffcf9a" />
      </Environment>
    </>
  );
}
