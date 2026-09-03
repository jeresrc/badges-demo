"use client";

import { useMemo } from "react";
import { useFont } from "@react-three/drei";
import { Color, ExtrudeGeometry, Float32BufferAttribute, Shape, Vector2 } from "three";
import type { BufferGeometry } from "three";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  CandyEnamelMaterial,
  EnamelMaterial,
  PinMaterialProvider,
  usePinMaterials,
  useShiftedColor,
} from "./materials";
import { BackPlate } from "./parts";
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
/* Proportions measured off refs/flower-medal.jpg with an angle-averaged      */
/* radial profile (R = outer radius). Every radius below is `fraction × R`.   */

const R = PIN_HALF_SIZE; // 1.10
const at = (fraction: number) => fraction * R;

/* Rim: a channel — outer wire glints at 0.995R, inner wire at 0.958R, and the
 * gold floor between (0.965–0.985R) reads as dark satin gold. */
const RIM_WIRE_OUTER: [number, number] = [at(0.991), R];
const RIM_WIRE_INNER: [number, number] = [at(0.958), at(0.967)];
/** Floor closes the channel; a hair inside both wires so no faces are coplanar. */
const RIM_FLOOR: [number, number] = [at(0.962), at(0.995)];

/* Inner ring: the same channel form, glints at 0.665R and 0.70R. */
const RING_WIRE_OUTER: [number, number] = [at(0.701), at(0.711)];
const RING_WIRE_INNER: [number, number] = [at(0.663), at(0.673)];
const RING_FLOOR: [number, number] = [at(0.667), at(0.706)];
/** Red field runs out to the inner wire. */
const FIELD_RADIUS = at(0.665);

/** Black band between the ring and the rim. */
const BAND: [number, number] = [at(0.709), at(0.962)];

const WIRE_DEPTH = 0.05;
/** Wires are half-round: bevel ≈ half the width so the crest is a rounded ridge. */
const WIRE_BEVEL = 0.005;
const WIRE_Z = RIM_FRONT - WIRE_DEPTH / 2 - WIRE_BEVEL;
const FLOOR_DEPTH = 0.03;
const FLOOR_Z = RIM_FRONT - 0.034 - FLOOR_DEPTH / 2;

/* Text band: cap height 0.16R centred on 0.83R. */
const TEXT_RADIUS = at(0.83);
const TEXT_SIZE = 0.205;
/** The reference typeface is a condensed grotesque; Helvetiker is squeezed. */
const TEXT_CONDENSE = 0.66;
const TEXT_TRACKING = 0.004;
const TEXT_DEPTH = 0.036;
/** Also fattens the strokes: the reference letters are bold. */
const TEXT_BEVEL = 0.009;
/** Glyph bases sink just into the black enamel so they read as struck metal. */
const TEXT_Z = RIM_FRONT - ENAMEL_RECESS - 0.008 + TEXT_DEPTH / 2;
/** Three repeats read clockwise, tops outward — centre angle of each. */
const TEXT_CENTERS = [45, -66, 190];
const STAR_ANGLES = [-10.5, -118];
const STAR_OUTER = 0.048;
const STAR_INNER = 0.021;
/** Long curved rule filling the leftover gap between the last BOY and FLOWER. */
const RULE_ARC: [number, number] = [138, 97];
const RULE_THICKNESS = 0.026;

const FONT_URL = "/fonts/typeface.json";

/* Sunflower: two staggered rings of twelve petals around a dark seed head.
 * Inner petals run pure yellow to 0.455R and tip out near 0.48R; outer tips
 * reach 0.60R; the head fills 0.285R. Widths make neighbours just touch. */
const PETAL_COUNT = 12;
const OUTER_PETAL = { base: at(0.3), tip: at(0.605), width: 0.29 };
const INNER_PETAL = { base: at(0.24), tip: at(0.485), width: 0.225 };
/** Visible gold cloisonné outline around each enamel petal. */
const OUTLINE = 0.008;
/** The seed head is a dark disc the inner petals lie on; it shows between
 * their bases out to ~0.36R and hides the outer petals' bases. No collar. */
const HEAD_RADIUS = at(0.37);

/* Z stack. `ExtrudeGeometry` places the caps at ±(depth / 2 + bevel) once
 * centred, so every "top" below is computed with `topOf()`. */
const topOf = (z: number, depth: number, bevel: number) => z + depth / 2 + bevel;

const FIELD_Z = 0.006;
const FIELD_DEPTH = 0.04;
const FIELD_BEVEL = 0.012;
const FIELD_SHOULDER = 0.014;

const PETAL_GOLD_DEPTH = 0.05;
const PETAL_GOLD_BEVEL = 0.005;
const PETAL_ENAMEL_DEPTH = 0.03;
const PETAL_ENAMEL_BEVEL = 0.004;
/** Flat pillow with a steep meniscus at the wall — that shoulder is what
 * catches the key light as the single crisp glint along each petal edge. */
const PETAL_SHOULDER = 0.014;
const OUTER_GOLD_Z = 0.04;
const INNER_GOLD_Z = 0.064;
const HEAD_ENAMEL_DEPTH = 0.03;
const HEAD_ENAMEL_BEVEL = 0.006;
/** Head cap sits between the outer petals' domes and the inner petals' walls. */
const HEAD_TOP = 0.086;

/** Enamel slab centre so its flat cap sits `lift` above a gold cap at `goldTop`. */
const enamelZFor = (goldTop: number, depth: number, bevel: number, lift = 0.002) =>
  goldTop + lift - depth / 2 - bevel;

/* Sampled off the reference: rendered sRGB targets. */
const HEAD_COLOR = "#461805";
const BAND_COLOR = "#120a04";

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
 * Sunflower petal pointing up the +Y axis: a leaf pointed at both ends, widest
 * a little above its middle. The narrow base is what leaves the dark spiky
 * wedges of seed head showing between the inner petals in the reference.
 */
function petalShape({ base, tip, width }: { base: number; tip: number; width: number }): Shape {
  const length = tip - base;
  const w = width / 2;
  const shape = new Shape();
  shape.moveTo(0, base);
  shape.bezierCurveTo(w * 0.7, base + length * 0.06, w * 1.38, base + length * 0.5, 0, tip);
  shape.bezierCurveTo(-w * 1.38, base + length * 0.5, -w * 0.7, base + length * 0.06, 0, base);
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

type Tint = { edge: [number, number, number]; hot: [number, number, number] };
/** Petals deepen only slightly at the wall: the reference enamel is flat and even. */
const OUTER_TINT: Tint = { edge: [0.94, 0.78, 0.55], hot: [0, 0, 0] };
const INNER_TINT: Tint = { edge: [0.96, 0.84, 0.55], hot: [0, 0, 0] };

/**
 * A ring of petals: die-struck gold outline with a gently domed enamel pour
 * set inside it. Built once pointing up and repeated around the head.
 */
function usePetalRing(spec: { base: number; tip: number; width: number }, phase: number, tint: Tint) {
  return useMemo(() => {
    const gold = petalShape(spec);
    const outline = gold.getPoints(40);
    const cell = offsetPolygon(outline, OUTLINE, 3);
    const edge = polygonDistance(cell);

    const goldGeometry = extrudeCentered(gold, {
      depth: PETAL_GOLD_DEPTH,
      bevel: PETAL_GOLD_BEVEL,
      curveSegments: 40,
      bevelSegments: 3,
    });
    const enamel = tintResin(
      pourResin(
        buildResinSlab(polygonShape(cell), PETAL_ENAMEL_DEPTH, PETAL_ENAMEL_BEVEL, 0.02),
        edge,
        PETAL_SHOULDER,
        spec.width * 0.22,
      ),
      edge,
      spec.width * 0.18,
      tint.edge,
      tint.hot,
    );
    return {
      gold: ringOf(goldGeometry, PETAL_COUNT, phase),
      enamel: ringOf(enamel, PETAL_COUNT, phase),
    };
  }, [spec, phase, tint]);
}

/** Half-round gold wire ring. */
function useWire([inner, outer]: [number, number]) {
  return useMemo(
    () =>
      extrudeCentered(circleShape(outer, inner), {
        depth: WIRE_DEPTH,
        bevel: Math.min(WIRE_BEVEL, (outer - inner) / 2 - 0.001),
        curveSegments: 128,
        bevelSegments: 5,
      }),
    [inner, outer],
  );
}

/** Flat gold floor of a channel, set below the wires. */
function useFloor([inner, outer]: [number, number]) {
  return useMemo(
    () =>
      extrudeCentered(circleShape(outer, inner), {
        depth: FLOOR_DEPTH,
        bevel: 0.003,
        curveSegments: 128,
        bevelSegments: 2,
      }),
    [inner, outer],
  );
}

/**
 * Satin enamel for the petals: the reference petals are evenly saturated with
 * broad, soft highlights — an opaque body with a slightly rough coat rather
 * than the wet mirror of candy glass.
 */
function PetalMaterial({ color }: { color: Color }) {
  const { envMapIntensity } = usePinMaterials();
  return (
    <meshPhysicalMaterial
      color={color}
      vertexColors
      metalness={0}
      roughness={0.5}
      clearcoat={0.7}
      clearcoatRoughness={0.14}
      reflectivity={0.12}
      envMapIntensity={envMapIntensity * 0.3}
      emissive={color}
      emissiveIntensity={0.34}
    />
  );
}

/**
 * The reference gold is pale and warm — glints read as light tan (~#b38b67)
 * rather than saturated yellow — so every gold surface on this badge uses a
 * paler alloy than the shared die-struck gold.
 */
function GoldMaterial() {
  const { metalness, metalRoughness, envMapIntensity } = usePinMaterials();
  return (
    <meshStandardMaterial
      color="#f4d098"
      metalness={metalness}
      roughness={Math.max(0.02, metalRoughness)}
      envMapIntensity={envMapIntensity * 1.15}
    />
  );
}

/**
 * Cloisonné walls between petals: in the reference they read as dark lines
 * (the wall tops sit in the petals' shadow), so they get a deeper, softer
 * finish than the wires and letters.
 */
function WallMaterial() {
  const { envMapIntensity } = usePinMaterials();
  return <meshStandardMaterial color="#b68a50" metalness={1} roughness={0.35} envMapIntensity={envMapIntensity * 0.5} />;
}

/**
 * Gold in the bottom of a channel: the reference floors read as dark warm
 * gold (~#7c4314) because the wires shade them, so the floor gets a duller,
 * dimmer finish than the wires standing over it.
 */
function FloorMaterial() {
  const { envMapIntensity } = usePinMaterials();
  return <meshStandardMaterial color="#d9b47a" metalness={1} roughness={0.45} envMapIntensity={envMapIntensity * 0.4} />;
}

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

    // Centre every glyph on the cap height of a reference capital so the
    // baseline sits at a constant radius (glyph bboxes differ per letter).
    const probe = extrudeCentered(font.generateShapes("E", TEXT_SIZE), { depth: 0.01, bevel: 0 });
    probe.computeBoundingBox();
    const capCentre = (probe.boundingBox!.min.y + probe.boundingBox!.max.y) / 2;
    probe.dispose();

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
          glyph.translate(-(box.min.x + box.max.x) / 2, -capCentre, 0);
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
      const star = extrudeCentered(starShape(5, STAR_OUTER, STAR_INNER), {
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
 * Sunflower medal following refs/flower-medal.jpg: channel-form gold rim and
 * inner ring (two fine wires over a dark satin floor), a black band carrying
 * raised "FLOWER BOY ★" lettering, then a hot red-orange candy-glass field
 * with a twelve-and-twelve petal sunflower in flat yellow enamel around a
 * dark seed head — every cell outlined in fine struck gold.
 *
 * The reference gold is satin and warm rather than mirror-bright, so the
 * shared settings are re-provided with a rougher metal for this badge only.
 */
export function FlowerMedal() {
  const settings = usePinMaterials();
  const satin = useMemo(
    () => ({ ...settings, metalRoughness: Math.max(settings.metalRoughness, 0.2) }),
    [settings],
  );
  return (
    <PinMaterialProvider value={satin}>
      <FlowerMedalBody />
    </PinMaterialProvider>
  );
}

function FlowerMedalBody() {
  const { enamelColor, envMapIntensity } = usePinMaterials();
  /** Petals are hue-shifted from the field toward the sampled amber / yellow. */
  const outerPetalColor = useShiftedColor(enamelColor, 0.07, -0.08, -0.03);
  const innerPetalColor = useShiftedColor(enamelColor, 0.079, 0, -0.03);
  const attenuation = useMemo(
    () => new Color(enamelColor).offsetHSL(-0.005, 0.05, -0.05),
    [enamelColor],
  );
  /** Field glows in the reference (overexposed enamel); a little emission gets there. */
  const fieldEmissive = useMemo(() => new Color(enamelColor).offsetHSL(0, 0, -0.1), [enamelColor]);

  const back = useMemo(() => circleShape(R - 0.02), []);
  const rimOuter = useWire(RIM_WIRE_OUTER);
  const rimInner = useWire(RIM_WIRE_INNER);
  const rimFloor = useFloor(RIM_FLOOR);
  const ringOuter = useWire(RING_WIRE_OUTER);
  const ringInner = useWire(RING_WIRE_INNER);
  const ringFloor = useFloor(RING_FLOOR);
  const bandGeometry = useMemo(
    () =>
      extrudeCentered(circleShape(BAND[1], BAND[0]), {
        depth: 0.04,
        bevel: 0.004,
        curveSegments: 128,
        bevelSegments: 2,
      }),
    [],
  );

  const fieldGeometry = useMemo(() => {
    const edge: EdgeDistance = (x, y) => FIELD_RADIUS - Math.hypot(x, y);
    const geometry = pourResin(
      buildResinSlab(circleShape(FIELD_RADIUS + 0.004), FIELD_DEPTH, FIELD_BEVEL, 0.05),
      edge,
      FIELD_SHOULDER,
      0.08,
    );
    return tintResin(geometry, edge, 0.06, [0.9, 0.62, 0.5], [0.02, 0.02, 0]);
  }, []);

  const headGeometry = useMemo(() => {
    const edge: EdgeDistance = (x, y) => HEAD_RADIUS - Math.hypot(x, y);
    const geometry = pourResin(
      buildResinSlab(circleShape(HEAD_RADIUS), HEAD_ENAMEL_DEPTH, HEAD_ENAMEL_BEVEL, 0.04),
      edge,
      0.004,
      0.12,
    );
    return tintResin(geometry, edge, 0.05, [0.85, 0.8, 0.8], [0.03, 0.02, 0.01]);
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
  const headEnamelZ = HEAD_TOP - HEAD_ENAMEL_DEPTH / 2 - HEAD_ENAMEL_BEVEL;
  const bandZ = RIM_FRONT - ENAMEL_RECESS - 0.02 - 0.004;

  return (
    <group name="flower-medal">
      <BackPlate shape={back} metal="gold" />

      {/* Rim channel: two fine wires over a dark satin floor. */}
      <mesh geometry={rimOuter} position={[0, 0, WIRE_Z]} castShadow receiveShadow>
        <GoldMaterial />
      </mesh>
      <mesh geometry={rimFloor} position={[0, 0, FLOOR_Z]} receiveShadow>
        <FloorMaterial />
      </mesh>
      <mesh geometry={rimInner} position={[0, 0, WIRE_Z]} receiveShadow>
        <GoldMaterial />
      </mesh>

      {/* Black band with the struck lettering. */}
      <mesh geometry={bandGeometry} position={[0, 0, bandZ]} receiveShadow>
        <EnamelMaterial color={BAND_COLOR} />
      </mesh>
      <mesh geometry={bandText} position={[0, 0, TEXT_Z]} receiveShadow>
        <GoldMaterial />
      </mesh>

      {/* Inner ring channel. */}
      <mesh geometry={ringOuter} position={[0, 0, WIRE_Z]} receiveShadow>
        <GoldMaterial />
      </mesh>
      <mesh geometry={ringFloor} position={[0, 0, FLOOR_Z]} receiveShadow>
        <FloorMaterial />
      </mesh>
      <mesh geometry={ringInner} position={[0, 0, WIRE_Z]} receiveShadow>
        <GoldMaterial />
      </mesh>

      {/* Red-orange candy glass field, meniscus rising against the ring. */}
      <mesh geometry={fieldGeometry} position={[0, 0, FIELD_Z]} receiveShadow>
        <CandyEnamelMaterial
          color={enamelColor}
          vertexColors
          attenuationColor={attenuation}
          attenuationDistance={0.5}
          thickness={0.6}
          emissive={fieldEmissive}
          emissiveIntensity={0.5}
        />
      </mesh>

      {/* Sunflower: outer ring of amber petals, inner ring of yellow ones. */}
      <mesh geometry={outerPetals.gold} position={[0, 0, OUTER_GOLD_Z]} receiveShadow>
        <WallMaterial />
      </mesh>
      <mesh geometry={outerPetals.enamel} position={[0, 0, outerEnamelZ]} receiveShadow>
        <PetalMaterial color={outerPetalColor} />
      </mesh>
      <mesh geometry={innerPetals.gold} position={[0, 0, INNER_GOLD_Z]} receiveShadow>
        <WallMaterial />
      </mesh>
      <mesh geometry={innerPetals.enamel} position={[0, 0, innerEnamelZ]} receiveShadow>
        <PetalMaterial color={innerPetalColor} />
      </mesh>

      {/* Seed head: dark chocolate disc under the inner petals. */}
      <mesh geometry={headGeometry} position={[0, 0, headEnamelZ]} receiveShadow>
        {/* Drier than the petals: a satin coat so the head reads as a dark
            seed disc rather than a black mirror. */}
        <meshPhysicalMaterial
          color={HEAD_COLOR}
          vertexColors
          metalness={0}
          roughness={0.55}
          clearcoat={0.3}
          clearcoatRoughness={0.3}
          envMapIntensity={envMapIntensity * 0.5}
        />
      </mesh>
    </group>
  );
}
