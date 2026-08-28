"use client";

import { useMemo } from "react";
import { Shape } from "three";
import type { BufferGeometry } from "three";
import { CandyEnamelMaterial, MetalMaterial, usePinMaterials } from "./materials";
import {
  extrudeCentered,
  offsetPolygon,
  regularPolygonPoints,
  roundedPolygonShape,
  roundedRectShape,
  sparkleShape,
  withHole,
} from "./shapes";

/* ------------------------------------------------------------------------ */
/* Proportions measured off the reference (refs/hex-medal.png)               */

/** Pointy-top hexagon: vertices at top and bottom, flats left and right. */
const HEX_RADIUS = 1.08;
const HEX_CORNER = 0.16;
/** Chrome border width; a regular hexagon offset inward keeps it even. */
const RIM_WIDTH = 0.1;
/** Circumradius shrink for an inward offset of a regular hexagon. */
const INNER_RADIUS = HEX_RADIUS - RIM_WIDTH / Math.cos(Math.PI / 6);

const RING_OUTER = 0.56;
const RING_INNER = 0.485;

/** Vertical chrome bars connecting rim to ring, mirrored left/right. */
const BAR_X = 0.3;
const BAR_WIDTH = 0.075;
/** Two short horizontal bars — the "=" plaque under the top vertex. */
const EQUALS_WIDTH = 0.2;
const EQUALS_HEIGHT = 0.048;

/** How far the poured-resin enamel puffs toward the camera at the centre. */
const DOME_HEIGHT = 0.025;

/* ------------------------------------------------------------------------ */

/** Radial dome: bows a freshly extruded slab so it reads as poured resin. */
function domed(geometry: BufferGeometry, amplitude: number, radius: number) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const falloff = 1 - Math.min(1, (x * x + y * y) / (radius * radius));
    position.setZ(i, position.getZ(i) + amplitude * falloff);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Yin-yang split of the centre disc: the chrome lobe covers the upper-left of
 * the circle, bounded by an arc over the top and an S-curve sweeping back
 * through the middle.
 */
function yinShape(radius: number): Shape {
  const a1 = (75 * Math.PI) / 180;
  const a2 = (195 * Math.PI) / 180;
  const shape = new Shape();
  shape.absarc(0, 0, radius, a1, a2, false);
  shape.bezierCurveTo(
    0.28 * radius,
    -0.42 * radius,
    0.52 * radius,
    0.28 * radius,
    Math.cos(a1) * radius,
    Math.sin(a1) * radius,
  );
  shape.closePath();
  return shape;
}

/** One vertical chrome bar (stadium profile) reaching from rim to ring. */
function Bar({ x, y0, y1 }: { x: number; y0: number; y1: number }) {
  const geometry = useMemo(
    () =>
      extrudeCentered(roundedRectShape(BAR_WIDTH, Math.abs(y1 - y0), BAR_WIDTH / 2), {
        depth: 0.04,
        bevel: 0.015,
        curveSegments: 24,
      }),
    [y0, y1],
  );
  return (
    <mesh geometry={geometry} position={[x, (y0 + y1) / 2, 0.052]} castShadow receiveShadow>
      <MetalMaterial metal="chrome" />
    </mesh>
  );
}

/**
 * War-medal hexagon closely following refs/hex-medal.png: mirror-chrome hex
 * rim, paired vertical bars top and bottom, an "=" plaque under the apex, a
 * heavy chrome ring holding a yin-yang split disc (chrome / orange), a concave
 * four-point sparkle star, and juicy candy-glass orange enamel poured into
 * every field, gently domed like resin.
 */
export function WarMedal() {
  const { enamelColor } = usePinMaterials();

  const hexInnerPoints = useMemo(
    () => offsetPolygon(regularPolygonPoints(6, HEX_RADIUS), RIM_WIDTH),
    [],
  );

  const rimGeometry = useMemo(() => {
    const outer = roundedPolygonShape(regularPolygonPoints(6, HEX_RADIUS), HEX_CORNER);
    const inner = roundedPolygonShape(hexInnerPoints, HEX_CORNER * 0.85);
    return extrudeCentered(withHole(outer, inner, 48), {
      depth: 0.12,
      bevel: 0.03,
      curveSegments: 24,
      bevelSegments: 7,
    });
  }, [hexInnerPoints]);

  const backGeometry = useMemo(
    () =>
      extrudeCentered(roundedPolygonShape(regularPolygonPoints(6, INNER_RADIUS + 0.04), HEX_CORNER), {
        depth: 0.04,
        bevel: 0.01,
        curveSegments: 24,
      }),
    [],
  );

  const hexEnamelGeometry = useMemo(
    () =>
      domed(
        extrudeCentered(roundedPolygonShape(hexInnerPoints, HEX_CORNER * 0.85), {
          depth: 0.06,
          bevel: 0.03,
          bevelSegments: 7,
          curveSegments: 24,
        }),
        DOME_HEIGHT,
        INNER_RADIUS,
      ),
    [hexInnerPoints],
  );

  const ringGeometry = useMemo(() => {
    const shape = new Shape();
    shape.absarc(0, 0, RING_OUTER, 0, Math.PI * 2, false);
    const ringHole = new Shape();
    ringHole.absarc(0, 0, RING_INNER, 0, Math.PI * 2, false);
    return extrudeCentered(withHole(shape, ringHole, 64), {
      depth: 0.05,
      bevel: 0.02,
      bevelSegments: 6,
      curveSegments: 96,
    });
  }, []);

  const discGeometry = useMemo(() => {
    const disc = new Shape();
    disc.absarc(0, 0, RING_INNER + 0.02, 0, Math.PI * 2, false);
    return domed(
      extrudeCentered(disc, { depth: 0.05, bevel: 0.02, bevelSegments: 6, curveSegments: 96 }),
      0.02,
      RING_INNER,
    );
  }, []);

  const yinGeometry = useMemo(
    () =>
      extrudeCentered(yinShape(RING_INNER - 0.015), {
        depth: 0.035,
        bevel: 0.018,
        bevelSegments: 6,
        curveSegments: 64,
      }),
    [],
  );

  const starGeometry = useMemo(
    () =>
      extrudeCentered(sparkleShape(0.19, 0.15, 0.16), {
        depth: 0.045,
        bevel: 0.02,
        bevelSegments: 6,
        curveSegments: 48,
      }),
    [],
  );

  const equalsGeometry = useMemo(
    () =>
      extrudeCentered(roundedRectShape(EQUALS_WIDTH, EQUALS_HEIGHT, EQUALS_HEIGHT / 2), {
        depth: 0.03,
        bevel: 0.012,
        curveSegments: 24,
      }),
    [],
  );

  return (
    <group name="war-medal">
      {/* Chrome shell */}
      <mesh geometry={backGeometry} position={[0, 0, -0.045]} castShadow receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>
      <mesh geometry={rimGeometry} castShadow receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>

      {/* Orange candy-glass pour filling the whole inner hex, gently domed. */}
      <mesh geometry={hexEnamelGeometry} receiveShadow>
        <CandyEnamelMaterial color={enamelColor} />
      </mesh>

      {/* Centre ring and its split disc. */}
      <mesh geometry={ringGeometry} position={[0, 0, 0.045]} castShadow receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>
      <mesh geometry={discGeometry} position={[0, 0, 0.02]} receiveShadow>
        <CandyEnamelMaterial color={enamelColor} />
      </mesh>
      <mesh geometry={yinGeometry} position={[0, 0, 0.055]} castShadow receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>
      <mesh geometry={starGeometry} position={[0.02, -0.03, 0.06]} castShadow receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>

      {/* Structure bars: rim-to-ring top pair, bottom pair, and the "=" mark. */}
      <Bar x={-BAR_X} y0={0.86} y1={0.56} />
      <Bar x={BAR_X} y0={0.86} y1={0.56} />
      <Bar x={-BAR_X} y0={-0.9} y1={-0.6} />
      <Bar x={BAR_X} y0={-0.9} y1={-0.6} />
      <mesh geometry={equalsGeometry} position={[0, 0.85, 0.05]} castShadow receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>
      <mesh geometry={equalsGeometry} position={[0, 0.75, 0.05]} castShadow receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>
    </group>
  );
}
