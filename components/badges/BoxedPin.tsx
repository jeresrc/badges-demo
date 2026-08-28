"use client";

import { useMemo } from "react";
import { LacquerMaterial, VelvetMaterial, usePinMaterials, useShiftedColor } from "./materials";
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
  const { enamelColor } = usePinMaterials();
  const secondColor = useShiftedColor(enamelColor, 0.52, -0.08, -0.02);

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

  return (
    // Tilted toward the camera so we look down into the open tray.
    <group rotation={[-0.42, 0, 0]} position={[0, -0.12, 0]} scale={0.92}>
      {/* Tray — lacquered shell, velvet insert on the floor. */}
      <mesh geometry={floorGeometry} position={[0, 0, -WALL_DEPTH / 2 + FLOOR_DEPTH / 2]} receiveShadow>
        <VelvetMaterial />
      </mesh>
      <mesh geometry={wallGeometry} castShadow receiveShadow>
        <LacquerMaterial />
      </mesh>

      {/* Lid, hinged along the top edge, swung back and resting open. */}
      <group position={[0, BOX_SIZE / 2, -WALL_DEPTH / 2]} rotation={[LID_OPEN_ANGLE, 0, 0]}>
        <mesh geometry={lidGeometry} position={[0, BOX_SIZE / 2, LID_DEPTH / 2]} castShadow receiveShadow>
          <LacquerMaterial />
        </mesh>
      </group>

      {/* Pins resting on the floor, one slightly overlapping the other. */}
      <group position={[-0.38, -0.3, -WALL_DEPTH / 2 + FLOOR_DEPTH + 0.07]} rotation={[0, 0, 0.35]} scale={0.5}>
        <MiniPin color={enamelColor} ring={false} />
      </group>
      <group
        position={[0.42, 0.32, -WALL_DEPTH / 2 + FLOOR_DEPTH + 0.09]}
        rotation={[0.12, -0.1, -0.5]}
        scale={0.5}
      >
        <MiniPin color={secondColor} ring />
      </group>
    </group>
  );
}
