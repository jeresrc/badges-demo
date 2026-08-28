"use client";

import { useMemo } from "react";
import { usePinMaterials } from "./materials";
import { BackPlate, DetailPiece, EnamelPiece, RimPiece } from "./parts";
import { BACK_INSET, PIN_HALF_SIZE, circleShape } from "./shapes";

const OUTER = PIN_HALF_SIZE; // 1.10
const RIM_WIDTH = 0.13;
const CAVITY = OUTER - RIM_WIDTH; // 0.97 — inner wall of the gold rim
const RING_OUTER = 0.6;
const RING_INNER = 0.47;
/** Enamel is grown slightly into the metal walls so no faces are coplanar. */
const FILL = 0.006;

/**
 * Round enamel pin — polished gold rim, a wide recessed enamel field and a
 * concentric raised gold ring splitting it from the enamel centre.
 */
export function CirclePin() {
  const { enamelColor } = usePinMaterials();

  const rim = useMemo(() => circleShape(OUTER, CAVITY), []);
  const ring = useMemo(() => circleShape(RING_OUTER, RING_INNER), []);
  const outerField = useMemo(() => circleShape(CAVITY + FILL, RING_OUTER - FILL), []);
  const centreField = useMemo(() => circleShape(RING_INNER + FILL), []);
  const back = useMemo(() => circleShape(OUTER - BACK_INSET), []);

  return (
    <group>
      <BackPlate shape={back} metal="gold" />
      <RimPiece shape={rim} metal="gold" />
      <EnamelPiece shape={outerField} color={enamelColor} />
      <DetailPiece shape={ring} metal="gold" />
      <EnamelPiece shape={centreField} color={enamelColor} />
    </group>
  );
}
