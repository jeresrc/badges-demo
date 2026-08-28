"use client";

import { useMemo } from "react";
import { usePinMaterials } from "./materials";
import { BackPlate, DetailPiece, EnamelPiece, RimPiece } from "./parts";
import {
  BACK_INSET,
  PIN_HALF_SIZE,
  barShape,
  circleShape,
  regularPolygonPoints,
  rotatedShape,
  roundedPolygonShape,
  starShape,
  withHole,
} from "./shapes";

const OUTER = PIN_HALF_SIZE; // circumradius
const RIM_WIDTH = 0.13;
const APOTHEM = OUTER * Math.cos(Math.PI / 6);
/** Scaling a regular polygon is an exact uniform inset, so derive from apothem. */
const CAVITY = (OUTER * (APOTHEM - RIM_WIDTH)) / APOTHEM;
const FILL = 0.007;
const CORNER = 0.16;
/** Offsetting a fillet inward shrinks its radius by the same amount. */
const CAVITY_CORNER = CORNER - RIM_WIDTH;

const HUB_OUTER = 0.42;
const HUB_INNER = 0.33;
const BAR_HALF_WIDTH = 0.05;

function hexShape(radius: number, corner: number) {
  return roundedPolygonShape(regularPolygonPoints(6, radius, Math.PI / 2), corner);
}

/**
 * Hexagonal badge with a mirror-chrome structural story: rim, spokes running
 * to each corner, and a chrome hub carrying a four-point star — all sitting in
 * candy-glass enamel that reads deep and wet because light transmits into it
 * and bounces off the chrome back plate.
 */
export function HexBadge() {
  const { enamelColor } = usePinMaterials();

  const rim = useMemo(
    () => withHole(hexShape(OUTER, CORNER), hexShape(CAVITY, CAVITY_CORNER), 12),
    [],
  );
  const core = useMemo(() => hexShape(CAVITY + FILL, CAVITY_CORNER), []);
  const back = useMemo(() => hexShape(OUTER - BACK_INSET, CORNER - BACK_INSET), []);
  const hub = useMemo(() => circleShape(HUB_OUTER, HUB_INNER), []);
  const star = useMemo(() => starShape(4, 0.24, 0.075), []);

  // Six spokes from the hub out to the corners of the hexagon.
  const spokes = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) =>
        rotatedShape(
          barShape(BAR_HALF_WIDTH, HUB_OUTER - 0.02, CAVITY - 0.02),
          (i / 6) * Math.PI * 2,
          1,
        ),
      ),
    [],
  );

  return (
    <group>
      <BackPlate shape={back} metal="chrome" curveSegments={12} />
      <RimPiece shape={rim} metal="chrome" curveSegments={12} />
      <EnamelPiece shape={core} color={enamelColor} curveSegments={12} candy />
      <DetailPiece shape={spokes} metal="chrome" curveSegments={2} depth={0.06} />
      <DetailPiece shape={hub} metal="chrome" curveSegments={64} depth={0.07} />
      <DetailPiece shape={star} metal="chrome" curveSegments={2} depth={0.08} />
    </group>
  );
}
