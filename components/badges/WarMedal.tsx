"use client";

import { useMemo } from "react";
import { Color, ExtrudeGeometry, Float32BufferAttribute, Shape } from "three";
import type { BufferGeometry } from "three";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CandyEnamelMaterial, MetalMaterial, usePinMaterials, useShiftedColor } from "./materials";
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
const RIM_WIDTH = 0.08;
/** Circumradius shrink for an inward offset of a regular hexagon. */
const INNER_RADIUS = HEX_RADIUS - RIM_WIDTH / Math.cos(Math.PI / 6);
const INNER_APOTHEM = INNER_RADIUS * Math.cos(Math.PI / 6);

const RING_OUTER = 0.56;
const RING_INNER = 0.49;

/** Thin vertical chrome pinstripes connecting rim to ring, mirrored. */
const BAR_X = 0.3;
const BAR_WIDTH = 0.055;
/** Two short horizontal bars — the "=" plaque under the top vertex. */
const EQUALS_WIDTH = 0.2;
const EQUALS_HEIGHT = 0.045;

/* Overfilled-resin profile: the glass plateau rises ABOVE the rim front
 * (0.09) with a rounded meniscus shoulder, and the chrome furniture is set
 * INTO the glass with only its crown standing proud. */

/** How far the resin plateau climbs from its slab toward the camera. */
const SHOULDER_HEIGHT = 0.05;
/** Width of the rounded meniscus rise from a cell edge to the plateau. */
const MENISCUS_WIDTH = 0.16;
/** Gentle extra doming toward the centre of a cell. */
const DOME_HEIGHT = 0.012;

/* Tonal map of the glass (multiplied into the enamel colour). */

/** How far from a cell edge the deep red-orange thickening reaches. */
const EDGE_TINT_WIDTH = 0.13;
/** Deep resin multiplier at cell edges (thick glass turns red-orange). */
const EDGE_TINT: [number, number, number] = [0.9, 0.6, 0.5];
/** Amber transmitted-light boost along the lower edges and corners. */
const GLOW_TINT: [number, number, number] = [0.7, 0.3, 0.04];
/** Slight hot lift for the upper-centre of a cell. */
const HOT_TINT: [number, number, number] = [0.14, 0.07, -0.05];

/* ------------------------------------------------------------------------ */

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function smooth(t: number) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Signed distance from (x, y) to the inner hex boundary (positive inside). */
function hexDistance(x: number, y: number, apothem: number) {
  let support = -Infinity;
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    support = Math.max(support, x * Math.cos(a) + y * Math.sin(a));
  }
  return apothem - support;
}

/**
 * Extruded slab with tessellated caps: `ExtrudeGeometry` only puts vertices
 * on the contours, so without tessellation a dome displacement would never
 * form. Normals are merged and recomputed fully smooth — soft like resin.
 */
function buildResinSlab(shape: Shape, depth: number, bevel: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    curveSegments: 48,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 5,
  });
  geometry.translate(0, 0, -depth / 2);
  const tessellated = new TessellateModifier(0.07, 10).modify(geometry);
  geometry.dispose();
  tessellated.deleteAttribute("normal");
  tessellated.deleteAttribute("uv");
  return mergeVertices(tessellated, 1e-4);
}

/**
 * Overfilled-resin displacement: a rounded meniscus shoulder climbing from
 * the cell edge to a raised plateau, plus a gentle dome toward the centre.
 * `edgeDistance` returns the distance to the cell boundary (0 at the edge).
 */
function pourResin(
  geometry: BufferGeometry,
  edgeDistance: (x: number, y: number) => number,
  radius: number,
  shoulderHeight = SHOULDER_HEIGHT,
  meniscusWidth = MENISCUS_WIDTH,
) {
  const position = geometry.attributes.position;
  const height = (x: number, y: number) =>
    shoulderHeight * smooth(edgeDistance(x, y) / meniscusWidth) +
    DOME_HEIGHT * (1 - clamp01((x * x + y * y) / (radius * radius)));

  // The flat front cap (pre-displacement) gets analytic normals afterwards:
  // tessellation leaves T-vertices whose averaged normals crack into seams.
  let zFront = -Infinity;
  for (let i = 0; i < position.count; i++) zFront = Math.max(zFront, position.getZ(i));
  const onCap: boolean[] = new Array(position.count);
  for (let i = 0; i < position.count; i++) {
    onCap[i] = position.getZ(i) > zFront - 1e-3;
  }

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    position.setZ(i, position.getZ(i) + height(x, y));
  }
  geometry.computeVertexNormals();

  const normal = geometry.attributes.normal;
  const eps = 0.01;
  for (let i = 0; i < position.count; i++) {
    if (!onCap[i]) continue;
    const x = position.getX(i);
    const y = position.getY(i);
    const dx = (height(x + eps, y) - height(x - eps, y)) / (2 * eps);
    const dy = (height(x, y + eps) - height(x, y - eps)) / (2 * eps);
    const inverseLength = 1 / Math.hypot(dx, dy, 1);
    normal.setXYZ(i, -dx * inverseLength, -dy * inverseLength, inverseLength);
  }
  normal.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Tonal vertex tints: hot saturated centre-top, deep red-orange where the
 * resin is thick (edges and bottoms), and an amber transmitted-light glow
 * along the lower edges. Multiplied into the enamel colour by the material.
 */
function tintResin(
  geometry: BufferGeometry,
  edgeDistance: (x: number, y: number) => number,
  { depthBase = 0.45, depthBottom = 0.4, hotRadial = false } = {},
) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const edge = 1 - smooth(edgeDistance(x, y) / EDGE_TINT_WIDTH);
    // Thickness tint is strongest at the bottom of the cell.
    const depthBias = edge * (depthBase + depthBottom * clamp01(0.5 - y * 0.8));
    let r = 1 + (EDGE_TINT[0] - 1) * depthBias;
    let g = 1 + (EDGE_TINT[1] - 1) * depthBias;
    let b = 1 + (EDGE_TINT[2] - 1) * depthBias;
    // Honey glow: light diving through the glass at the lower corners.
    const glow = edge * clamp01(-y * 0.9 - 0.05);
    r += GLOW_TINT[0] * glow;
    g += GLOW_TINT[1] * glow;
    b += GLOW_TINT[2] * glow;
    // Hot zone: upper-centre of a cell, or the whole plateau for the disc.
    const hot = (1 - edge) * (hotRadial ? 0.7 : clamp01(y * 0.9 + 0.25));
    r += HOT_TINT[0] * hot;
    g += HOT_TINT[1] * hot;
    b += HOT_TINT[2] * hot;
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Yin-yang split of the centre disc: the chrome lobe covers the upper-left of
 * the circle, bounded by an arc over the top and an S-curve sweeping back
 * through the middle.
 */
function yinShape(radius: number): Shape {
  const a1 = (62 * Math.PI) / 180;
  const a2 = (200 * Math.PI) / 180;
  const shape = new Shape();
  shape.absarc(0, 0, radius, a1, a2, false);
  // S back through the centre: the chrome dips low left of centre, then the
  // wave crest pushes right of centre before exiting at the top.
  shape.quadraticCurveTo(-0.18 * radius, -0.42 * radius, 0, 0);
  shape.quadraticCurveTo(0.32 * radius, 0.16 * radius, Math.cos(a1) * radius, Math.sin(a1) * radius);
  shape.closePath();
  return shape;
}

/** One vertical chrome pinstripe set into the glass, crown standing proud. */
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
    <mesh geometry={geometry} position={[x, (y0 + y1) / 2, 0.1]} receiveShadow>
      <MetalMaterial metal="chrome" />
    </mesh>
  );
}

/**
 * War-medal hexagon closely following refs/hex-medal.png: mirror-chrome hex
 * rim, thin bars connecting rim to a polished centre ring, a yin-yang split
 * disc (chrome / orange), a concave four-point sparkle star, an "=" plaque
 * under the apex — all pressed into overfilled candy-glass orange enamel
 * that domes above the chrome frame with rounded meniscus shoulders.
 */
export function WarMedal() {
  const { enamelColor } = usePinMaterials();
  /** Centre field reads slightly deeper and redder than the outer cells. */
  const discColor = useShiftedColor(enamelColor, -0.012, 0.02, -0.01);
  const attenuation = useMemo(
    () => new Color(enamelColor).offsetHSL(-0.02, 0.05, -0.06),
    [enamelColor],
  );

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

  const hexEnamelGeometry = useMemo(() => {
    // The pour stops under the centre ring: without this hole the disc would
    // be seen through the hex glass and read dark. The meniscus rises against
    // both the rim and the ring.
    const holeRadius = (RING_OUTER + RING_INNER) / 2;
    const edge = (x: number, y: number) =>
      Math.min(hexDistance(x, y, INNER_APOTHEM), Math.hypot(x, y) - holeRadius);
    const outline = roundedPolygonShape(hexInnerPoints, HEX_CORNER * 0.85);
    const hole = new Shape();
    hole.absarc(0, 0, holeRadius, 0, Math.PI * 2, false);
    const geometry = pourResin(
      buildResinSlab(withHole(outline, hole, 64), 0.08, 0.02),
      edge,
      INNER_RADIUS,
    );
    return tintResin(geometry, edge);
  }, [hexInnerPoints]);

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
    const radius = RING_INNER + 0.02;
    const disc = new Shape();
    disc.absarc(0, 0, radius, 0, Math.PI * 2, false);
    const edge = (x: number, y: number) => RING_INNER - Math.hypot(x, y);
    const geometry = pourResin(buildResinSlab(disc, 0.05, 0.02), edge, RING_INNER, 0.03, 0.3);
    return tintResin(geometry, edge, { depthBase: 0.3, depthBottom: 0.25, hotRadial: true });
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

      {/* Overfilled orange pour: plateau above the rim, meniscus shoulders. */}
      <mesh geometry={hexEnamelGeometry} receiveShadow>
        <CandyEnamelMaterial
          color={enamelColor}
          vertexColors
          attenuationColor={attenuation}
          attenuationDistance={0.5}
          thickness={0.9}
        />
      </mesh>

      {/* Centre ring and its split disc, set into the glass. */}
      <mesh geometry={ringGeometry} position={[0, 0, 0.09]} receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>
      <mesh geometry={discGeometry} position={[0, 0, 0.03]} receiveShadow>
        <CandyEnamelMaterial
          color={discColor}
          vertexColors
          attenuationColor={attenuation}
          attenuationDistance={0.45}
          thickness={0.9}
        />
      </mesh>
      <mesh geometry={yinGeometry} position={[0, 0, 0.095]} receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>
      <mesh geometry={starGeometry} position={[0.02, -0.03, 0.11]} receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>

      {/* Structure bars: rim-to-ring pairs and the "=" mark under the apex. */}
      <Bar x={-BAR_X} y0={0.86} y1={0.5} />
      <Bar x={BAR_X} y0={0.86} y1={0.5} />
      <Bar x={-BAR_X} y0={-0.9} y1={-0.54} />
      <Bar x={BAR_X} y0={-0.9} y1={-0.54} />
      <mesh geometry={equalsGeometry} position={[0, 0.85, 0.105]} receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>
      <mesh geometry={equalsGeometry} position={[0, 0.75, 0.105]} receiveShadow>
        <MetalMaterial metal="chrome" />
      </mesh>
    </group>
  );
}
