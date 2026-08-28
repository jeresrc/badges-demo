"use client";

import { useMemo } from "react";
import { usePinMaterials, useShiftedColor } from "./materials";
import { BackPlate, DetailPiece, EnamelPiece, RimPiece } from "./parts";
import {
  BACK_INSET,
  PIN_HALF_SIZE,
  bandPolygon,
  clipPolygon,
  offsetPolygon,
  polygonShape,
  shieldPoints,
} from "./shapes";

const HEIGHT = PIN_HALF_SIZE * 2; // 2.20
const WIDTH = 1.78;
const RIM_WIDTH = 0.13;
const FILL = 0.006;
/** Height band occupied by the raised brass divider between the two fields. */
const DIVIDER_BOTTOM = 0.14;
const DIVIDER_TOP = 0.25;

/**
 * Heraldic shield — brass rim, a raised brass bar splitting the face into two
 * enamel fields. Silhouette is sampled once and inset along vertex bisectors so
 * the rim keeps an even width all the way into the rounded tip.
 */
export function ShieldPin() {
  const { enamelColor } = usePinMaterials();
  const lowerColor = useShiftedColor(enamelColor, -0.055, -0.1, 0.14);

  const { rim, back, divider, upperField, lowerField } = useMemo(() => {
    const outline = shieldPoints(WIDTH, HEIGHT, 22);
    const cavity = offsetPolygon(outline, RIM_WIDTH);
    // Enamel/divider outline overlaps the walls slightly to avoid coplanar faces.
    const fill = offsetPolygon(outline, RIM_WIDTH - FILL);

    return {
      rim: polygonShape(outline, cavity),
      back: polygonShape(offsetPolygon(outline, BACK_INSET)),
      divider: polygonShape(bandPolygon(fill, DIVIDER_BOTTOM, DIVIDER_TOP)),
      upperField: polygonShape(clipPolygon(fill, { value: DIVIDER_TOP - FILL, keep: "above" })),
      lowerField: polygonShape(clipPolygon(fill, { value: DIVIDER_BOTTOM + FILL, keep: "below" })),
    };
  }, []);

  return (
    <group>
      <BackPlate shape={back} metal="brass" curveSegments={4} />
      <RimPiece shape={rim} metal="brass" curveSegments={4} />
      <EnamelPiece shape={upperField} color={enamelColor} curveSegments={4} />
      <EnamelPiece shape={lowerField} color={lowerColor} curveSegments={4} />
      <DetailPiece shape={divider} metal="brass" curveSegments={4} />
    </group>
  );
}
