"use client";

import { useMemo } from "react";
import { usePinMaterials } from "./materials";
import { BackPlate, DetailPiece, EnamelPiece, RimPiece } from "./parts";
import { BACK_INSET, PIN_HALF_SIZE, circleShape, ellipseShape, starShape } from "./shapes";

const RY = PIN_HALF_SIZE; // 1.10
const RX = 0.84;
const RIM_WIDTH = 0.12;
const FILL = 0.006;

const DOT_RADIUS = 0.072;
const DOT_Y = -0.46;
const DOT_SPACING = 0.27;

/**
 * Vertical oval — silver rim over a dark enamel field carrying a raised silver
 * star and a row of studs, so there is polished metal reading against enamel in
 * the middle of the face as well as at the edge.
 */
export function OvalPin() {
  const { enamelColor } = usePinMaterials();

  const rim = useMemo(() => ellipseShape(RX, RY, RX - RIM_WIDTH, RY - RIM_WIDTH), []);
  const field = useMemo(() => ellipseShape(RX - RIM_WIDTH + FILL, RY - RIM_WIDTH + FILL), []);
  const back = useMemo(() => ellipseShape(RX - BACK_INSET, RY - BACK_INSET), []);
  const star = useMemo(() => starShape(5, 0.36, 0.155), []);
  const studs = useMemo(
    () => [-1, 0, 1].map((i) => circleShape(DOT_RADIUS, 0, i * DOT_SPACING, DOT_Y)),
    [],
  );

  return (
    <group>
      <BackPlate shape={back} metal="silver" />
      <RimPiece shape={rim} metal="silver" />
      <EnamelPiece shape={field} color={enamelColor} />
      <DetailPiece shape={star} metal="silver" offset={[0, 0.26]} curveSegments={4} />
      <DetailPiece shape={studs} metal="silver" curveSegments={32} />
    </group>
  );
}
