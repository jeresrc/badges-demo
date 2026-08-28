"use client";

import { useMemo } from "react";
import { Center, Text3D } from "@react-three/drei";
import { MetalMaterial, usePinMaterials, useShiftedColor } from "./materials";
import { BackPlate, DetailPiece, EnamelPiece, RimPiece } from "./parts";
import {
  BACK_INSET,
  ENAMEL_Z,
  PIN_HALF_SIZE,
  RIM_FRONT,
  circleShape,
  petalShape,
  rotatedShape,
} from "./shapes";

const OUTER = PIN_HALF_SIZE; // 1.10
const RIM_WIDTH = 0.1;
const CAVITY = OUTER - RIM_WIDTH; // outer wall of the text ring cavity
const RING_OUTER = 0.62;
const RING_INNER = 0.53;
const FILL = 0.006;

const TEXT_RADIUS = 0.795;
const TEXT_SIZE = 0.185;
const TEXT_HEIGHT = 0.05;
/** Glyph base sits just above the enamel so the letters read as struck metal. */
const TEXT_Z = ENAMEL_Z + 0.012;

const PETAL_COUNT = 6;
const PETAL_LENGTH = 0.44;
const PETAL_WIDTH = 0.16;

const FONT_URL = "/fonts/typeface.json";

/**
 * One string of characters laid along an arc. `outward = true` points the top
 * of each glyph away from the centre (upper arc); `false` points it inward
 * (lower arc) so both lines read left-to-right.
 */
function ArcText({
  text,
  startAngle,
  endAngle,
  outward,
}: {
  text: string;
  startAngle: number;
  endAngle: number;
  outward: boolean;
}) {
  const chars = [...text];
  return (
    <>
      {chars.map((char, i) => {
        if (char === " ") return null;
        const t = chars.length > 1 ? i / (chars.length - 1) : 0.5;
        const angle = startAngle + (endAngle - startAngle) * t;
        const x = Math.cos(angle) * TEXT_RADIUS;
        const y = Math.sin(angle) * TEXT_RADIUS;
        const roll = outward ? angle - Math.PI / 2 : angle + Math.PI / 2;
        return (
          <group key={`${char}-${i}`} position={[x, y, TEXT_Z]} rotation={[0, 0, roll]}>
            <Center disableZ>
              <Text3D
                font={FONT_URL}
                size={TEXT_SIZE}
                height={TEXT_HEIGHT}
                curveSegments={8}
                bevelEnabled
                bevelThickness={0.01}
                bevelSize={0.008}
                bevelSegments={3}
                castShadow
                receiveShadow
              >
                {char}
                <MetalMaterial metal="gold" />
              </Text3D>
            </Center>
          </group>
        );
      })}
    </>
  );
}

/**
 * Gold medallion — polished rim, a recessed enamel ring carrying raised struck
 * text, then an inner gold ring around an enamel centre with a petal-flower
 * relief in gold and a lighter enamel.
 */
export function Medallion() {
  const { enamelColor } = usePinMaterials();
  const petalEnamel = useShiftedColor(enamelColor, 0.035, 0.05, 0.18);

  const rim = useMemo(() => circleShape(OUTER, CAVITY), []);
  const ring = useMemo(() => circleShape(RING_OUTER, RING_INNER), []);
  const textField = useMemo(() => circleShape(CAVITY + FILL, RING_OUTER - FILL), []);
  const centreField = useMemo(() => circleShape(RING_INNER + FILL), []);
  const back = useMemo(() => circleShape(OUTER - BACK_INSET), []);
  const centreDot = useMemo(() => circleShape(0.085), []);

  const goldPetals = useMemo(
    () =>
      Array.from({ length: PETAL_COUNT }, (_, i) =>
        rotatedShape(petalShape(PETAL_LENGTH, PETAL_WIDTH, 0.05), (i / PETAL_COUNT) * Math.PI * 2),
      ),
    [],
  );
  const enamelPetals = useMemo(
    () =>
      Array.from({ length: PETAL_COUNT }, (_, i) =>
        rotatedShape(
          petalShape(PETAL_LENGTH * 0.72, PETAL_WIDTH * 0.55, 0.08),
          (i / PETAL_COUNT) * Math.PI * 2,
        ),
      ),
    [],
  );

  return (
    <group>
      <BackPlate shape={back} metal="gold" />
      <RimPiece shape={rim} metal="gold" />
      <EnamelPiece shape={textField} color={enamelColor} />
      <DetailPiece shape={ring} metal="gold" />
      <EnamelPiece shape={centreField} color={enamelColor} />

      {/* Petal flower: struck gold petals with lighter enamel poured inside. */}
      <DetailPiece shape={goldPetals} metal="gold" curveSegments={24} depth={0.06} />
      <EnamelPiece shape={enamelPetals} color={petalEnamel} curveSegments={24} z={RIM_FRONT - 0.028} />
      <DetailPiece shape={centreDot} metal="gold" curveSegments={48} depth={0.075} />

      <ArcText text="BADGE CLUB" startAngle={Math.PI * 0.86} endAngle={Math.PI * 0.14} outward />
      <ArcText text="EST. MMXXVI" startAngle={Math.PI * 1.17} endAngle={Math.PI * 1.83} outward={false} />
    </group>
  );
}
