"use client";

import { useMemo } from "react";
import { useFont } from "@react-three/drei";
import { Color, ExtrudeGeometry, Float32BufferAttribute, Shape, Vector2 } from "three";
import type { BufferGeometry } from "three";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CandyEnamelMaterial, EnamelMaterial, MetalMaterial, usePinMaterials, useShiftedColor } from "./materials";
import { BackPlate, DetailPiece, EnamelPiece, RimPiece } from "./parts";
import {
  ENAMEL_RECESS,
  PIN_HALF_SIZE,
  RIM_FRONT,
  circleShape,
  extrudeCentered,
  offsetPolygon,
  polygonShape,
  starShape,
} from "./shapes";

/* ------------------------------------------------------------------------ */
/* Proportions measured off the reference (refs/flower-medal.jpg)            */

const OUTER = PIN_HALF_SIZE; // 1.10
/** Double-line rim: gold wall, a black groove, then a thin gold fillet. */
const RIM_INNER = 1.052;
const GROOVE_INNER = 1.02;
const FILLET_INNER = 1.0;
/** Inner gold ring separating the black text band from the red field. */
const RING_OUTER = 0.75;
const RING_INNER = 0.722;
const FILL = 0.006;

const TEXT_RADIUS = 0.875;
const TEXT_SIZE = 0.175;
/** The reference typeface is a condensed grotesque; Helvetiker is squeezed. */
const TEXT_CONDENSE = 0.78;
const TEXT_TRACKING = 0.01;
const TEXT_DEPTH = 0.04;
const TEXT_BEVEL = 0.008;
/** Glyph bases sink just into the black enamel so they read as struck metal. */
const TEXT_Z = RIM_FRONT - ENAMEL_RECESS - 0.008 + TEXT_DEPTH / 2;
/** Three repeats read clockwise, tops outward — centre angle of each. */
const TEXT_CENTERS = [45, -66, 190];
const STAR_ANGLES = [-10.5, -118];
/** Long curved rule filling the leftover gap between the last BOY and FLOWER. */
const RULE_ARC: [number, number] = [138, 97];
const RULE_THICKNESS = 0.03;

const FONT_URL = "/fonts/typeface.json";

/* Sunflower: two staggered rings of twelve petals around a dark seed head. */
const PETAL_COUNT = 12;
const OUTER_PETAL = { base: 0.26, tip: 0.645, width: 0.215 };
const INNER_PETAL = { base: 0.2, tip: 0.46, width: 0.185 };
/** Visible gold cloisonné outline around each enamel petal. */
const OUTLINE = 0.011;
const HEAD_RING_OUTER = 0.312;
const HEAD_RING_INNER = 0.297;

/* Z stack. `ExtrudeGeometry` places the caps at ±(depth / 2 + bevel) once
 * centred, so every "top" below is computed with `topOf()`. The field sits
 * just below the inner ring; each layer of the flower stands a little prouder
 * than the last, and each enamel pour rises from its gold cell wall. */
const topOf = (z: number, depth: number, bevel: number) => z + depth / 2 + bevel;

const FIELD_Z = 0.006;
const FIELD_DEPTH = 0.04;
const FIELD_BEVEL = 0.012;
const FIELD_SHOULDER = 0.016;

const PETAL_GOLD_DEPTH = 0.05;
const PETAL_GOLD_BEVEL = 0.007;
const PETAL_ENAMEL_DEPTH = 0.03;
const PETAL_ENAMEL_BEVEL = 0.005;
/** How far the pillow of each petal rises above its gold cell wall. */
const PETAL_SHOULDER = 0.016;
const OUTER_GOLD_Z = 0.04;
const INNER_GOLD_Z = 0.056;
/** The head must clear the inner petals' pillows so their bases stay buried. */
const HEAD_GOLD_Z = 0.088;
const HEAD_ENAMEL_DEPTH = 0.03;
const HEAD_ENAMEL_BEVEL = 0.008;

/** Enamel slab centre so its flat cap sits `lift` above a gold cap at `goldTop`. */
const enamelZFor = (goldTop: number, depth: number, bevel: number, lift = 0.002) =>
  goldTop + lift - depth / 2 - bevel;

/* ------------------------------------------------------------------------ */

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function smooth(t: number) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

const rad = (deg: number) => (deg * Math.PI) / 180;

type EdgeDistance = (x: number, y: number) => number;

/** Distance from (x, y) to the nearest edge of a closed polygon. */
function polygonDistance(points: Vector2[]): EdgeDistance {
  return (x, y) => {
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const lengthSq = ex * ex + ey * ey || 1e-12;
      const t = clamp01(((x - a.x) * ex + (y - a.y) * ey) / lengthSq);
      const dx = x - (a.x + ex * t);
      const dy = y - (a.y + ey * t);
      best = Math.min(best, dx * dx + dy * dy);
    }
    return Math.sqrt(best);
  };
}

/**
 * Extruded slab with tessellated caps so a dome can form (ExtrudeGeometry only
 * places vertices on the contour), merged and left fully smooth like resin.
 */
function buildResinSlab(shape: Shape, depth: number, bevel: number, tessellation: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    curveSegments: 48,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 4,
  });
  geometry.translate(0, 0, -depth / 2);
  const tessellated = new TessellateModifier(tessellation, 12).modify(geometry);
  geometry.dispose();
  tessellated.deleteAttribute("normal");
  tessellated.deleteAttribute("uv");
  return mergeVertices(tessellated, 1e-4);
}

/**
 * Poured-enamel displacement: a rounded meniscus rising from the cell wall to
 * a plateau. With `meniscus` about half the cell width the whole cell becomes
 * one soft pillow. Cap normals come from the height-field gradient so the
 * tessellation's T-vertices never crack into seams.
 */
function pourResin(geometry: BufferGeometry, edge: EdgeDistance, shoulder: number, meniscus: number) {
  const position = geometry.attributes.position;
  const height = (x: number, y: number) => shoulder * smooth(edge(x, y) / meniscus);

  let zFront = -Infinity;
  for (let i = 0; i < position.count; i++) zFront = Math.max(zFront, position.getZ(i));
  const onCap: boolean[] = new Array(position.count);
  for (let i = 0; i < position.count; i++) onCap[i] = position.getZ(i) > zFront - 1e-3;

  for (let i = 0; i < position.count; i++) {
    position.setZ(i, position.getZ(i) + height(position.getX(i), position.getY(i)));
  }
  geometry.computeVertexNormals();

  const normal = geometry.attributes.normal;
  const eps = 0.005;
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
 * Tonal vertex tints multiplied into the enamel colour: the body deepens
 * toward the cell wall where the glass is thickest, and lifts a touch toward
 * the centre where light escapes the pour most directly.
 */
function tintResin(
  geometry: BufferGeometry,
  edge: EdgeDistance,
  edgeWidth: number,
  edgeTint: [number, number, number],
  hotTint: [number, number, number],
) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const wall = 1 - smooth(edge(position.getX(i), position.getY(i)) / edgeWidth);
    const hot = 1 - wall;
    colors[i * 3] = 1 + (edgeTint[0] - 1) * wall + hotTint[0] * hot;
    colors[i * 3 + 1] = 1 + (edgeTint[1] - 1) * wall + hotTint[1] * hot;
    colors[i * 3 + 2] = 1 + (edgeTint[2] - 1) * wall + hotTint[2] * hot;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Sunflower petal pointing up the +Y axis: a soft leaf that is widest a little
 * below its middle and closes to a crisp tip.
 */
function petalShape({ base, tip, width }: { base: number; tip: number; width: number }): Shape {
  const length = tip - base;
  const w = width / 2;
  const shape = new Shape();
  shape.moveTo(0, base);
  shape.bezierCurveTo(w * 1.25, base, w * 1.3, base + length * 0.55, 0, tip);
  shape.bezierCurveTo(-w * 1.3, base + length * 0.55, -w * 1.25, base, 0, base);
  shape.closePath();
  return shape;
}

/** Curved rule following the text band, running clockwise from `from` to `to`. */
function arcRule(radius: number, thickness: number, from: number, to: number): Shape {
  const shape = new Shape();
  shape.absarc(0, 0, radius + thickness / 2, rad(from), rad(to), true);
  shape.absarc(0, 0, radius - thickness / 2, rad(to), rad(from), false);
  shape.closePath();
  return shape;
}

/** Twelve copies of a geometry rotated around the origin, merged into one. */
function ringOf(geometry: BufferGeometry, count: number, phase: number): BufferGeometry {
  const copies: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    copies.push(geometry.clone().rotateZ(phase + (i / count) * Math.PI * 2));
  }
  const merged = mergeGeometries(copies);
  copies.forEach((copy) => copy.dispose());
  geometry.dispose();
  return merged;
}

/**
 * A ring of petals: die-struck gold outline with a pillowed enamel pour set
 * inside it. Built once pointing up and repeated around the head.
 */
function usePetalRing(
  spec: { base: number; tip: number; width: number },
  phase: number,
  tint: { edge: [number, number, number]; hot: [number, number, number] },
) {
  return useMemo(() => {
    const gold = petalShape(spec);
    const outline = gold.getPoints(40);
    const cell = offsetPolygon(outline, OUTLINE, 3);
    const edge = polygonDistance(cell);

    const goldGeometry = extrudeCentered(gold, {
      depth: PETAL_GOLD_DEPTH,
      bevel: PETAL_GOLD_BEVEL,
      curveSegments: 40,
      bevelSegments: 4,
    });
    const enamel = tintResin(
      pourResin(
        buildResinSlab(polygonShape(cell), PETAL_ENAMEL_DEPTH, PETAL_ENAMEL_BEVEL, 0.02),
        edge,
        PETAL_SHOULDER,
        spec.width * 0.3,
      ),
      edge,
      spec.width * 0.3,
      tint.edge,
      tint.hot,
    );
    return {
      gold: ringOf(goldGeometry, PETAL_COUNT, phase),
      enamel: ringOf(enamel, PETAL_COUNT, phase),
    };
  }, [spec, phase, tint]);
}

type Tint = { edge: [number, number, number]; hot: [number, number, number] };
/** Outer petals deepen to burnt orange at the wall; inner ones stay sunnier. */
const OUTER_TINT: Tint = { edge: [0.95, 0.7, 0.4], hot: [0, 0, 0] };
const INNER_TINT: Tint = { edge: [0.97, 0.78, 0.4], hot: [0, 0.02, 0] };

/**
 * "FLOWER BOY" laid along the band three times, glyph tops pointing outward,
 * spaced by the font's own advances so the rhythm stays even, plus the two
 * stars and the long curved rule that fill the gaps in the reference.
 */
function useBandText() {
  const font = useFont(FONT_URL);
  return useMemo(() => {
    const { glyphs, resolution } = font.data;
    const scale = (TEXT_SIZE / resolution) * TEXT_CONDENSE;
    const text = "FLOWER BOY";
    const chars = [...text];
    const advances = chars.map((char) => (glyphs[char]?.ha ?? glyphs["a"]?.ha ?? 500) * scale);
    const total = advances.reduce((sum, a) => sum + a, 0) + TEXT_TRACKING * (chars.length - 1);

    const pieces: BufferGeometry[] = [];
    for (const centre of TEXT_CENTERS) {
      let cursor = 0;
      const start = rad(centre) + total / 2 / TEXT_RADIUS;
      chars.forEach((char, i) => {
        const advance = advances[i];
        if (char !== " ") {
          const glyph = extrudeCentered(font.generateShapes(char, TEXT_SIZE), {
            depth: TEXT_DEPTH,
            bevel: TEXT_BEVEL,
            curveSegments: 6,
            bevelSegments: 3,
          });
          glyph.computeBoundingBox();
          const box = glyph.boundingBox!;
          glyph.translate(-(box.min.x + box.max.x) / 2, -TEXT_SIZE * 0.36, 0);
          glyph.scale(TEXT_CONDENSE, 1, 1);
          const angle = start - (cursor + advance / 2) / TEXT_RADIUS;
          glyph.rotateZ(angle - Math.PI / 2);
          glyph.translate(Math.cos(angle) * TEXT_RADIUS, Math.sin(angle) * TEXT_RADIUS, 0);
          pieces.push(glyph);
        }
        cursor += advance + TEXT_TRACKING;
      });
    }

    for (const deg of STAR_ANGLES) {
      const star = extrudeCentered(starShape(5, 0.062, 0.028), {
        depth: TEXT_DEPTH,
        bevel: TEXT_BEVEL,
        curveSegments: 4,
        bevelSegments: 3,
        creaseAngle: Math.PI / 4,
      });
      star.rotateZ(rad(deg) - Math.PI / 2);
      star.translate(Math.cos(rad(deg)) * TEXT_RADIUS, Math.sin(rad(deg)) * TEXT_RADIUS, 0);
      pieces.push(star);
    }

    pieces.push(
      extrudeCentered(arcRule(TEXT_RADIUS, RULE_THICKNESS, RULE_ARC[0], RULE_ARC[1]), {
        depth: TEXT_DEPTH,
        bevel: TEXT_BEVEL,
        curveSegments: 48,
        bevelSegments: 3,
      }),
    );

    const merged = mergeGeometries(pieces);
    pieces.forEach((piece) => piece.dispose());
    return merged;
  }, [font]);
}

/**
 * Sunflower medal following refs/flower-medal.jpg: gold double-line rim, a
 * glossy black band carrying raised "FLOWER BOY ★" lettering, a thin inner
 * ring, then a hot red-orange candy-glass field with a twelve-and-twelve
 * petal sunflower in pillowed yellow enamel around a dark seed head — every
 * cell outlined in struck gold.
 */
export function FlowerMedal() {
  const { enamelColor, envMapIntensity } = usePinMaterials();
  /** Petals are hue-shifted from the field: burnt orange outside, sun yellow inside. */
  const outerPetalColor = useShiftedColor(enamelColor, 0.075, 0, -0.03);
  const innerPetalColor = useShiftedColor(enamelColor, 0.1, 0, -0.01);
  const attenuation = useMemo(
    () => new Color(enamelColor).offsetHSL(-0.01, 0.05, -0.08),
    [enamelColor],
  );

  const back = useMemo(() => circleShape(OUTER - 0.025), []);
  const rim = useMemo(() => circleShape(OUTER, RIM_INNER), []);
  const groove = useMemo(() => circleShape(RIM_INNER + FILL, GROOVE_INNER - FILL), []);
  const fillet = useMemo(() => circleShape(GROOVE_INNER, FILLET_INNER), []);
  const band = useMemo(() => circleShape(FILLET_INNER + FILL, RING_OUTER - FILL), []);
  const ring = useMemo(() => circleShape(RING_OUTER, RING_INNER), []);
  const headRingGeometry = useMemo(
    () =>
      extrudeCentered(circleShape(HEAD_RING_OUTER, HEAD_RING_INNER), {
        depth: PETAL_GOLD_DEPTH,
        bevel: PETAL_GOLD_BEVEL,
        curveSegments: 96,
        bevelSegments: 4,
      }),
    [],
  );

  const fieldGeometry = useMemo(() => {
    const edge: EdgeDistance = (x, y) => RING_INNER - Math.hypot(x, y);
    const geometry = pourResin(
      buildResinSlab(circleShape(RING_INNER + 0.005), FIELD_DEPTH, FIELD_BEVEL, 0.05),
      edge,
      FIELD_SHOULDER,
      0.1,
    );
    return tintResin(geometry, edge, 0.1, [0.92, 0.6, 0.48], [0.05, 0.04, -0.02]);
  }, []);

  const headGeometry = useMemo(() => {
    const edge: EdgeDistance = (x, y) => HEAD_RING_INNER - Math.hypot(x, y);
    const geometry = pourResin(
      buildResinSlab(circleShape(HEAD_RING_INNER + 0.005), HEAD_ENAMEL_DEPTH, HEAD_ENAMEL_BEVEL, 0.04),
      edge,
      0.01,
      0.14,
    );
    return tintResin(geometry, edge, 0.08, [0.7, 0.6, 0.6], [0.12, 0.08, 0.02]);
  }, []);

  const outerPetals = usePetalRing(OUTER_PETAL, 0, OUTER_TINT);
  const innerPetals = usePetalRing(INNER_PETAL, Math.PI / PETAL_COUNT, INNER_TINT);
  const bandText = useBandText();

  const outerEnamelZ = enamelZFor(
    topOf(OUTER_GOLD_Z, PETAL_GOLD_DEPTH, PETAL_GOLD_BEVEL),
    PETAL_ENAMEL_DEPTH,
    PETAL_ENAMEL_BEVEL,
  );
  const innerEnamelZ = enamelZFor(
    topOf(INNER_GOLD_Z, PETAL_GOLD_DEPTH, PETAL_GOLD_BEVEL),
    PETAL_ENAMEL_DEPTH,
    PETAL_ENAMEL_BEVEL,
  );
  // The seed head sits a hair below its collar: a flat, dry-looking pour.
  const headEnamelZ = enamelZFor(
    topOf(HEAD_GOLD_Z, PETAL_GOLD_DEPTH, PETAL_GOLD_BEVEL),
    HEAD_ENAMEL_DEPTH,
    HEAD_ENAMEL_BEVEL,
    -0.012,
  );

  return (
    <group name="flower-medal">
      {/* Gold shell: double-line rim with a black groove between the lines. */}
      <BackPlate shape={back} metal="gold" />
      <RimPiece shape={rim} metal="gold" />
      <EnamelPiece shape={groove} color="#070605" />
      <DetailPiece shape={fillet} metal="gold" />

      {/* Glossy black band with the struck lettering. */}
      <EnamelPiece shape={band} color="#080706" />
      <mesh geometry={bandText} position={[0, 0, TEXT_Z]} receiveShadow>
        <MetalMaterial metal="gold" />
      </mesh>
      <DetailPiece shape={ring} metal="gold" />

      {/* Red-orange candy glass field, meniscus rising against the ring. */}
      <mesh geometry={fieldGeometry} position={[0, 0, FIELD_Z]} receiveShadow>
        <CandyEnamelMaterial
          color={enamelColor}
          vertexColors
          attenuationColor={attenuation}
          attenuationDistance={0.45}
          thickness={0.8}
        />
      </mesh>

      {/* Sunflower: outer ring of orange petals, inner ring of yellow ones. */}
      <mesh geometry={outerPetals.gold} position={[0, 0, OUTER_GOLD_Z]} receiveShadow>
        <MetalMaterial metal="gold" />
      </mesh>
      <mesh geometry={outerPetals.enamel} position={[0, 0, outerEnamelZ]} receiveShadow>
        <EnamelMaterial color={outerPetalColor} vertexColors />
      </mesh>
      <mesh geometry={innerPetals.gold} position={[0, 0, INNER_GOLD_Z]} receiveShadow>
        <MetalMaterial metal="gold" />
      </mesh>
      <mesh geometry={innerPetals.enamel} position={[0, 0, innerEnamelZ]} receiveShadow>
        <EnamelMaterial color={innerPetalColor} vertexColors />
      </mesh>

      {/* Seed head: dark chocolate enamel in a gold collar. */}
      <mesh geometry={headRingGeometry} position={[0, 0, HEAD_GOLD_Z]} receiveShadow>
        <MetalMaterial metal="gold" />
      </mesh>
      <mesh geometry={headGeometry} position={[0, 0, headEnamelZ]} receiveShadow>
        {/* Drier than the petals: a satin coat so the head reads as a dark
            seed disc rather than a black mirror. */}
        <meshPhysicalMaterial
          color="#4c2209"
          vertexColors
          metalness={0}
          roughness={0.45}
          clearcoat={0.35}
          clearcoatRoughness={0.25}
          envMapIntensity={envMapIntensity * 0.7}
        />
      </mesh>
    </group>
  );
}
