"use client";

import { useEffect, useMemo } from "react";
import {
  LacquerMaterial,
  PinMaterialProvider,
  VelvetMaterial,
  usePinMaterials,
  useShiftedColor,
} from "./materials";
import { BackPlate, DetailPiece, EnamelPiece, RimPiece } from "./parts";
import type { ColorRepresentation } from "three";
import {
  BACK_INSET,
  circleShape,
  extrudeCentered,
  roundedRectShape,
  starShape,
  withHole,
} from "./shapes";

const BOX_SIZE = 2.15;
const BOX_CORNER = 0.16;
const WALL = 0.13;
const WALL_DEPTH = 0.5;
const FLOOR_DEPTH = 0.1;
const LID_DEPTH = 0.16;
/** How far past closed the lid swings back (radians from the box plane). */
const LID_OPEN_ANGLE = Math.PI * 0.62;

/** One small gold pin, reused twice inside the box. */
function MiniPin({ color, ring }: { color: ColorRepresentation; ring: boolean }) {
  const rim = useMemo(() => circleShape(1, 0.87), []);
  const field = useMemo(() => circleShape(0.88), []);
  const back = useMemo(() => circleShape(1 - BACK_INSET), []);
  const detail = useMemo(
    () => (ring ? circleShape(0.5, 0.4) : starShape(5, 0.52, 0.23)),
    [ring],
  );

  return (
    <group>
      <BackPlate shape={back} metal="gold" />
      <RimPiece shape={rim} metal="gold" />
      <EnamelPiece shape={field} color={color} />
      <DetailPiece shape={detail} metal="gold" curveSegments={ring ? 64 : 2} />
    </group>
  );
}

/**
 * Presentation box: piano-black lacquered tray facing the camera with the lid
 * hinged open at the top, two glossy pins resting on the black floor. Single
 * moody key light does the rest — the box is meant to melt into the black
 * background so only its lacquer highlights and the pins carry the image.
 */
export function BoxedPin() {
  const materials = usePinMaterials();
  const { enamelColor } = materials;
  // Companion pin stays in the same family — a touch warmer and deeper.
  const secondColor = useShiftedColor(enamelColor, 0.04, 0.02, -0.01);
  // The pins are the focal point but raw env intensity makes the gold bloom
  // into a halo; tame it slightly so highlights stay crisp, not glowing.
  const pinMaterials = useMemo(
    () => ({ ...materials, envMapIntensity: materials.envMapIntensity * 0.7 }),
    [materials],
  );

  const wallGeometry = useMemo(() => {
    const outline = roundedRectShape(BOX_SIZE, BOX_SIZE, BOX_CORNER);
    const cavity = roundedRectShape(BOX_SIZE - WALL * 2, BOX_SIZE - WALL * 2, BOX_CORNER - WALL / 2);
    return extrudeCentered(withHole(outline, cavity, 8), { depth: WALL_DEPTH, bevel: 0.02, curveSegments: 8 });
  }, []);

  const floorGeometry = useMemo(
    () =>
      extrudeCentered(roundedRectShape(BOX_SIZE - 0.04, BOX_SIZE - 0.04, BOX_CORNER), {
        depth: FLOOR_DEPTH,
        bevel: 0.015,
        curveSegments: 8,
      }),
    [],
  );

  const lidGeometry = useMemo(
    () =>
      extrudeCentered(roundedRectShape(BOX_SIZE, BOX_SIZE, BOX_CORNER), {
        depth: LID_DEPTH,
        bevel: 0.02,
        curveSegments: 8,
      }),
    [],
  );

  useEffect(
    () => () => {
      wallGeometry.dispose();
      floorGeometry.dispose();
      lidGeometry.dispose();
    },
    [floorGeometry, lidGeometry, wallGeometry],
  );

  return (
    // Tilted toward the camera so we look down into the open tray.
    <group rotation={[-0.42, 0, 0]} position={[0, -0.12, 0]} scale={0.92}>
      {/* Tray — lacquered shell, velvet insert on the floor. */}
      <mesh geometry={floorGeometry} position={[0, 0, -WALL_DEPTH / 2 + FLOOR_DEPTH / 2]}>
        <VelvetMaterial />
      </mesh>
      <mesh geometry={wallGeometry}>
        <LacquerMaterial />
      </mesh>

      {/* Lid, hinged along the top edge, swung back and resting open. */}
      <group position={[0, BOX_SIZE / 2, -WALL_DEPTH / 2]} rotation={[LID_OPEN_ANGLE, 0, 0]}>
        <mesh geometry={lidGeometry} position={[0, BOX_SIZE / 2, LID_DEPTH / 2]}>
          <LacquerMaterial />
        </mesh>
      </group>

      {/* Pins resting casually on the velvet: one laid nearly flat, the
          other tipped up against the far wall as if dropped in by hand. */}
      <PinMaterialProvider value={pinMaterials}>
        <group
          position={[-0.34, -0.32, -WALL_DEPTH / 2 + FLOOR_DEPTH + 0.06]}
          rotation={[0.1, 0.06, 0.42]}
          scale={0.5}
        >
          <MiniPin color={enamelColor} ring={false} />
        </group>
        <group
          position={[0.4, 0.38, -WALL_DEPTH / 2 + FLOOR_DEPTH + 0.08]}
          rotation={[0.06, 0.08, -0.55]}
          scale={0.5}
        >
          <MiniPin color={secondColor} ring />
        </group>
      </PinMaterialProvider>
    </group>
  );
}
