"use client";

import { useMemo } from "react";
import type { ColorRepresentation, Shape } from "three";
import { EnamelMaterial, MetalMaterial } from "./materials";
import type { MetalKind } from "./materials";
import {
  BACK_BEVEL,
  BACK_DEPTH,
  BACK_Z,
  DETAIL_BEVEL,
  DETAIL_DEPTH,
  DETAIL_Z,
  ENAMEL_BEVEL,
  ENAMEL_DEPTH,
  ENAMEL_Z,
  RIM_BEVEL,
  RIM_DEPTH,
  extrudeCentered,
} from "./shapes";

type PieceProps = {
  shape: Shape | Shape[];
  curveSegments?: number;
};

function useExtruded(
  shape: Shape | Shape[],
  depth: number,
  bevel: number,
  curveSegments: number,
) {
  return useMemo(
    () => extrudeCentered(shape, { depth, bevel, curveSegments }),
    [shape, depth, bevel, curveSegments],
  );
}

/** Outer wall of the pin: full thickness, bevelled on both faces. */
export function RimPiece({ shape, metal, curveSegments = 96 }: PieceProps & { metal: MetalKind }) {
  const geometry = useExtruded(shape, RIM_DEPTH, RIM_BEVEL, curveSegments);
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <MetalMaterial metal={metal} />
    </mesh>
  );
}

/** Raised metal inside the badge face — rings, dividers, emblems. */
export function DetailPiece({
  shape,
  metal,
  curveSegments = 96,
  offset = [0, 0],
}: PieceProps & { metal: MetalKind; offset?: [number, number] }) {
  const geometry = useExtruded(shape, DETAIL_DEPTH, DETAIL_BEVEL, curveSegments);
  return (
    <mesh geometry={geometry} position={[offset[0], offset[1], DETAIL_Z]} castShadow receiveShadow>
      <MetalMaterial metal={metal} />
    </mesh>
  );
}

/** A pour of hard enamel filling one cavity. */
export function EnamelPiece({ shape, color, curveSegments = 96 }: PieceProps & { color: ColorRepresentation }) {
  const geometry = useExtruded(shape, ENAMEL_DEPTH, ENAMEL_BEVEL, curveSegments);
  return (
    <mesh geometry={geometry} position={[0, 0, ENAMEL_Z]} receiveShadow>
      <EnamelMaterial color={color} />
    </mesh>
  );
}

/** Thin plate closing the back of the pin and forming the cavity floor. */
export function BackPlate({ shape, metal, curveSegments = 96 }: PieceProps & { metal: MetalKind }) {
  const geometry = useExtruded(shape, BACK_DEPTH, BACK_BEVEL, curveSegments);
  return (
    <mesh geometry={geometry} position={[0, 0, BACK_Z]} castShadow receiveShadow>
      <MetalMaterial metal={metal} />
    </mesh>
  );
}
