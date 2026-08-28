"use client";

import { useMemo } from "react";
import { usePinMaterials } from "./materials";
import { BackPlate, EnamelPiece, RimPiece } from "./parts";
import {
  BACK_INSET,
  PIN_HALF_SIZE,
  regularPolygonPoints,
  roundedPolygonShape,
  withHole,
} from "./shapes";

const OUTER = PIN_HALF_SIZE; // circumradius
const RIM_WIDTH = 0.14;
const APOTHEM = OUTER * Math.cos(Math.PI / 6);
/** Scaling a regular polygon is an exact uniform inset, so derive from apothem. */
const CAVITY = (OUTER * (APOTHEM - RIM_WIDTH)) / APOTHEM;
const FILL = 0.007;
const CORNER = 0.18;
/** Offsetting a fillet inward shrinks its radius by the same amount. */
const CAVITY_CORNER = CORNER - RIM_WIDTH;

function hexShape(radius: number, corner: number) {
  return roundedPolygonShape(regularPolygonPoints(6, radius, Math.PI / 2), corner);
}

/**
 * Pointy-top hexagon — mirror chrome rim around a single vibrant enamel core,
 * corners softened so the bevel reads as a continuous highlight around the edge.
 */
export function HexPin() {
  const { enamelColor } = usePinMaterials();

  const rim = useMemo(
    () => withHole(hexShape(OUTER, CORNER), hexShape(CAVITY, CAVITY_CORNER), 12),
    [],
  );
  const core = useMemo(() => hexShape(CAVITY + FILL, CAVITY_CORNER), []);
  const back = useMemo(() => hexShape(OUTER - BACK_INSET, CORNER - BACK_INSET), []);

  return (
    <group>
      <BackPlate shape={back} metal="chrome" curveSegments={12} />
      <RimPiece shape={rim} metal="chrome" curveSegments={12} />
      <EnamelPiece shape={core} color={enamelColor} curveSegments={12} />
    </group>
  );
}
