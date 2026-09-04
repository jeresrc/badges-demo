"use client";

import { useMemo, useRef } from "react";
import { useFont } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { Color, Shape, Vector2, Vector3 } from "three";
import type { BufferGeometry, Group } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  CELL_ENAMEL_BEVEL,
  CELL_ENAMEL_DEPTH,
  CELL_GOLD_BEVEL,
  CELL_GOLD_DEPTH,
  CELL_OUTLINE,
  FLOOR_BEVEL,
  FLOOR_DEPTH,
  FLOOR_Z,
  TEXT_ROUGHNESS,
  WIRE_BEVEL,
  WIRE_DEPTH,
  WIRE_ROUGHNESS,
  WIRE_Z,
  buildResinSlab,
  cellEnamelZ,
  polygonDistance,
  pourResin,
  rad,
  smooth,
  tintResin,
} from "./cloisonne";
import type { EdgeDistance, Tint } from "./cloisonne";
import {
  AlloyMaterial,
  BandLacquerMaterial,
  CandyEnamelMaterial,
  FloorMaterial,
  PinMaterialProvider,
  SatinEnamelMaterial,
  WallMaterial,
  usePinMaterials,
} from "./materials";
import { BackPlate } from "./parts";
import {
  ENAMEL_RECESS,
  PIN_HALF_SIZE,
  RIM_FRONT,
  extrudeCentered,
  offsetPolygon,
  polygonShape,
  starShape,
} from "./shapes";

/* ------------------------------------------------------------------------ */
/* Silhouette: a wide oval — the fourth member of the set, next to the round
 * FLOWER BOY, the pink IGOR capsule and the hexagonal suitcase pin. Every
 * inner contour is a true parallel curve of the outer ellipse so the gold
 * lines keep an even width the whole way round.                             */

const A = PIN_HALF_SIZE; // 1.10 semi-axis across
const B = 0.86; // semi-axis up

/* Edge language is the flower medal's, converted from its measured radial
 * fractions (× R) to inward offsets from this oval's outer edge: an offset of
 * `(1 - fraction) × R` puts a contour on the same line of the badge. Both pins
 * therefore carry the same channel rim — two ~0.009 wide half-round wires over
 * a recessed dark floor — the same black lettering band and the same inner
 * ring, at the same proportion of their silhouettes. */
const off = (fraction: number) => (1 - fraction) * PIN_HALF_SIZE;

/** Rim channel: outer wire on the very edge, inner wire, dark floor between. */
const RIM_WIRE_OUTER: [number, number] = [off(1), off(0.992)];
const RIM_WIRE_INNER: [number, number] = [off(0.9645), off(0.9565)];
/** Floor closes the channel; a hair inside both wires so no faces are coplanar. */
const RIM_FLOOR: [number, number] = [off(0.995), off(0.962)];

/** Black lettering band. */
const BAND: [number, number] = [off(0.96), off(0.706)];

/** Inner ring: the same channel form again. */
const RING_WIRE_OUTER: [number, number] = [off(0.708), off(0.7)];
const RING_WIRE_INNER: [number, number] = [off(0.669), off(0.661)];
const RING_FLOOR: [number, number] = [off(0.704), off(0.665)];
/** Candy-glass field runs out to the inner wire. */
const FIELD_OFFSET = off(0.665);

/* Text band: same track position and same glyph treatment as FLOWER BOY. */
const TEXT_OFFSET = off(0.826);
const TITLE_SIZE = 0.19;
const CAPTION_SIZE = 0.15;
/** The reference typeface is a condensed grotesque; Helvetiker is squeezed. */
const TEXT_CONDENSE = 0.66;
const TEXT_TRACKING = 0.004;
const TEXT_DEPTH = 0.036;
/** Also fattens the strokes: the reference letters are bold. */
const TEXT_BEVEL = 0.011;
/** Glyph bases sink just into the black enamel so they read as struck metal. */
const TEXT_Z = RIM_FRONT - ENAMEL_RECESS - 0.008 + TEXT_DEPTH / 2;
const RULE_THICKNESS = 0.026;
/** Short curved rules on the flanks fill the gap between the title and the
 * caption's stars (angles from +X, radians). */
const RULE_SPAN = 0.55;
const RULE_CENTERS = [rad(20), rad(160)];
const STAR_ADVANCE = 0.11;

const FONT_URL = "/fonts/typeface.json";

const FIELD_Z = 0.006;
const FIELD_DEPTH = 0.04;
const FIELD_BEVEL = 0.012;
const FIELD_SHOULDER = 0.014;

/** Flat pillow with a steep meniscus at the wall, exactly as the petals pour. */
const CELL_SHOULDER = 0.011;

/* Z stack of the graphic, front to back. The eggs are sandwiched: the bowl and
 * the two back rows of twigs sit under them, the two front rows over them, so
 * the eggs read as cradled inside the nest rather than laid on top of it. */
const BOWL_Z = 0.018;
const NEST_BACK_Z = [0.026, 0.034];
const BACK_EGG_GOLD_Z = 0.044;
const FRONT_EGG_GOLD_Z = 0.054;
const SHINE_GOLD_Z = 0.062;
const NEST_FRONT_Z = [0.072, 0.08];

/* ------------------------------------------------------------------------ */
/* The graphic: two golden eggs cradled in a woven nest.                     */

type EggSpec = {
  length: number;
  width: number;
  centre: [number, number];
  /** Direction of the narrow end, degrees from +X. */
  heading: number;
  goldZ: number;
  /** Highlight cell, in egg-local units of (width, length). */
  shine: { at: [number, number]; size: [number, number]; tilt: number };
};

const EGGS: EggSpec[] = [
  // Front egg: a touch larger, leaning left.
  {
    length: 0.72,
    width: 0.55,
    centre: [-0.17, 0.05],
    heading: 100,
    goldZ: FRONT_EGG_GOLD_Z,
    shine: { at: [-0.22, 0.2], size: [0.06, 0.13], tilt: 22 },
  },
  // Back egg: tucked behind the first, leaning right.
  {
    length: 0.68,
    width: 0.51,
    centre: [0.23, 0.035],
    heading: 78,
    goldZ: BACK_EGG_GOLD_Z,
    shine: { at: [-0.08, 0.27], size: [0.05, 0.11], tilt: 20 },
  },
];

/* Sized so that even at full hover rock (MAX_ROCK about the blunt end) the
 * pointed end stays clear of the inner wire — the eggs reach for the ring the
 * way the sunflower's petals do without ever crossing it. */

/** Egg profile: widest a little below the middle, closing to a narrower top. */
const EGG_TAPER = 0.17;

const EGG_COLOR = "#f2b232";
const SHINE_COLOR = "#fce9ad";

/* Motion. */
const DROP_HEIGHT = 0.42;
const GRAVITY = 5.5;
const RESTITUTION = 0.32;
const SETTLE_SPEED = 0.25;
/** Frames must be flowing smoothly for this long before the reveal starts —
 * on first paint the GPU is still compiling shaders and nothing is presented,
 * so a drop that started at mount would be over before anyone saw it. */
const WARMUP_FRAMES = 4;
const WARMUP_SMOOTH_DELTA = 0.05;
const REVEAL_DELAY = 0.35;
const ROCK_STIFFNESS = 110;
const ROCK_DAMPING = 5;
const HOVER_KICK = 1.3;
const MAX_ROCK = 0.12;

/* ---- Ellipse helpers ---------------------------------------------------- */

/** Point on the parallel curve `d` inside the ellipse (a, b) at angle theta. */
function ellipseOffsetPoint(a: number, b: number, d: number, theta: number, target = new Vector2()) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const nx = b * c;
  const ny = a * s;
  const inv = 1 / Math.hypot(nx, ny);
  return target.set(a * c - d * nx * inv, b * s - d * ny * inv);
}

function ellipseOffsetPoints(a: number, b: number, d: number, count: number, from: number, to: number): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i < count; i++) {
    const theta = from + ((to - from) * i) / (count - 1);
    points.push(ellipseOffsetPoint(a, b, d, theta));
  }
  return points;
}

const FULL_TURN = Math.PI * 2 * (1 - 1 / 192);

/** Closed parallel curve as a shape, optionally with a parallel-curve hole. */
function ovalShape(outerOffset: number, innerOffset?: number): Shape {
  const outer = ellipseOffsetPoints(A, B, outerOffset, 192, 0, FULL_TURN);
  const inner = innerOffset === undefined ? undefined : ellipseOffsetPoints(A, B, innerOffset, 192, 0, FULL_TURN);
  return polygonShape(outer, inner);
}

/** A curved rule following the band between two angles. */
function ovalRule(offset: number, thickness: number, from: number, to: number): Shape {
  const outer = ellipseOffsetPoints(A, B, offset - thickness / 2, 32, from, to);
  const inner = ellipseOffsetPoints(A, B, offset + thickness / 2, 32, to, from);
  return polygonShape([...outer, ...inner]);
}

/**
 * Arc-length parametrisation of one parallel curve, so glyphs can be laid
 * along it with the font's own advances and stay evenly spaced even though
 * the curvature changes between the flanks and the top.
 */
function ovalTrack(offset: number) {
  const N = 2048;
  const points: Vector2[] = [];
  const lengths: number[] = [0];
  for (let i = 0; i <= N; i++) {
    const p = ellipseOffsetPoint(A, B, offset, (i / N) * Math.PI * 2);
    points.push(p);
    if (i > 0) lengths.push(lengths[i - 1] + p.distanceTo(points[i - 1]));
  }
  const total = lengths[N];
  const sAt = (theta: number) => {
    const t = (((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
    const f = t * N;
    const i = Math.min(N - 1, Math.floor(f));
    return lengths[i] + (lengths[i + 1] - lengths[i]) * (f - i);
  };
  const at = (s: number) => {
    let u = ((s % total) + total) % total;
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] <= u) lo = mid;
      else hi = mid;
    }
    const span = lengths[hi] - lengths[lo] || 1e-9;
    u = (u - lengths[lo]) / span;
    const point = points[lo].clone().lerp(points[hi], u);
    const tangent = points[hi].clone().sub(points[lo]).normalize();
    return { point, tangent };
  };
  return { total, sAt, at };
}

/**
 * How far (x, y) lies inside the ring's inner edge, measured along the ellipse
 * normal — exact enough for a parallel curve this far from the foci. Negative
 * outside. Everything drawn on the field is fitted against this.
 */
function fieldDepth(x: number, y: number) {
  const theta = Math.atan2(y / B, x / A);
  const p = ellipseOffsetPoint(A, B, FIELD_OFFSET, theta);
  const nx = B * Math.cos(theta);
  const ny = A * Math.sin(theta);
  const inv = 1 / Math.hypot(nx, ny);
  return (p.x - x) * nx * inv + (p.y - y) * ny * inv;
}

/** Pulls any point that strays outside the field back in along the normal. */
function clampToField(points: Vector2[], margin: number): Vector2[] {
  return points.map((p) => {
    const depth = fieldDepth(p.x, p.y);
    if (depth >= margin) return p;
    const theta = Math.atan2(p.y / B, p.x / A);
    const nx = B * Math.cos(theta);
    const ny = A * Math.sin(theta);
    const inv = (margin - depth) / Math.hypot(nx, ny);
    return new Vector2(p.x - nx * inv, p.y - ny * inv);
  });
}

/** Points along an ellipse arc, `from`/`to` in degrees. */
function ellipseArcPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  steps: number,
): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = rad(from + ((to - from) * i) / steps);
    points.push(new Vector2(cx + rx * Math.cos(theta), cy + ry * Math.sin(theta)));
  }
  return points;
}

/* ---- Cells -------------------------------------------------------------- */

/**
 * One cloisonné cell, built the way the sunflower petals are: the outline is
 * struck gold, the enamel is a slab inset by the wire width with a soft
 * pillow rising from the wall. Returns both geometries in the shape's frame.
 */
function buildCell(outline: Shape, width: number, tint: Tint, divisions = 48, tessellation = 0.02) {
  const points = outline.getPoints(divisions);
  const cell = offsetPolygon(points, CELL_OUTLINE, 3);
  return buildCellFrom(outline, cell, width, tint, divisions, tessellation);
}

/**
 * A cell whose enamel island is supplied directly rather than derived by
 * offsetting the outline — a twig's inner stroke is simply a shorter, thinner
 * stroke on the same centreline, which stays clean where a polygon offset
 * would fold over itself at the tapered tips.
 */
function buildCellFrom(
  outline: Shape,
  island: Vector2[],
  width: number,
  tint: Tint,
  divisions: number,
  tessellation: number,
) {
  const edge = polygonDistance(island);
  const gold = extrudeCentered(outline, {
    depth: CELL_GOLD_DEPTH,
    bevel: CELL_GOLD_BEVEL,
    curveSegments: divisions,
    bevelSegments: 3,
  });
  const enamel = tintResin(
    pourResin(
      buildResinSlab(polygonShape(island), CELL_ENAMEL_DEPTH, CELL_ENAMEL_BEVEL, tessellation),
      edge,
      CELL_SHOULDER,
      width * 0.45,
    ),
    edge,
    width * 0.2,
    tint.edge,
    tint.hot,
  );
  return { gold, enamel };
}

/* ---- Shapes ------------------------------------------------------------- */

/** Egg outline pointing up the +Y axis, centred on the origin. */
function eggShape(length: number, width: number, steps = 40): Shape {
  const right: Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = -Math.cos((i / steps) * Math.PI); // -1 .. 1, dense at the poles
    const r = Math.sqrt(Math.max(0, 1 - t * t)) * (1 - EGG_TAPER * t);
    right.push(new Vector2((r * width) / 2, (t * length) / 2));
  }
  const left = right
    .slice(1, -1)
    .reverse()
    .map((p) => new Vector2(-p.x, p.y));
  return polygonShape([...right, ...left]);
}

/** Small tilted oval — the illustrator's highlight on a glossy egg. */
function shineShape(rx: number, ry: number, tilt: number, cx: number, cy: number): Shape {
  const points: Vector2[] = [];
  const c = Math.cos(rad(tilt));
  const s = Math.sin(rad(tilt));
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    points.push(new Vector2(cx + x * c - y * s, cy + x * s + y * c));
  }
  return polygonShape(points);
}

/* ---- The nest ----------------------------------------------------------- */

/**
 * A twig: a tapered, gently bowed stroke, pointed at both ends and a little
 * thicker at its butt. Laid down in overlapping rows these are what make the
 * nest read as woven sticks instead of a chocolate dish.
 */
type TwigTemplate = { len: number; halfWidth: number; bend: number };

const TWIG_TEMPLATES: TwigTemplate[] = [
  { len: 0.48, halfWidth: 0.025, bend: -0.05 },
  { len: 0.4, halfWidth: 0.024, bend: -0.075 },
  { len: 0.34, halfWidth: 0.023, bend: -0.045 },
  { len: 0.28, halfWidth: 0.022, bend: -0.095 },
  { len: 0.22, halfWidth: 0.021, bend: -0.035 },
];

/** Centreline of a twig: a flat parabola so it follows the curve of the bowl. */
function twigCentre(len: number, bend: number, t: number) {
  const u = t - 0.5;
  return new Vector2(u * len, bend * len * (1 - 4 * u * u));
}

/**
 * How fast a twig closes to its ends, as a fraction of its length. Keeping the
 * stick near full width along most of its span and tapering only over the last
 * eighth is what separates a stick from a leaf — a sine profile carries far too
 * much belly and the courses read as a pile of pods.
 */
const TWIG_TAPER = 0.13;

/** Outline of one twig, pointing along +X and centred on the origin. */
function twigOutline(len: number, halfWidth: number, bend: number, steps = 32): Vector2[] {
  const width = (t: number) =>
    halfWidth * smooth(Math.min(t, 1 - t) / TWIG_TAPER) * (1 - 0.3 * (t - 0.5));
  const normal = (t: number) => {
    const a = twigCentre(len, bend, Math.max(0, t - 1e-3));
    const b = twigCentre(len, bend, Math.min(1, t + 1e-3));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const inv = 1 / Math.hypot(dx, dy);
    return new Vector2(-dy * inv, dx * inv);
  };

  const right: Vector2[] = [];
  const left: Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const centre = twigCentre(len, bend, t);
    if (i === 0 || i === steps) {
      right.push(centre);
      continue;
    }
    const n = normal(t).multiplyScalar(width(t));
    right.push(centre.clone().add(n));
    left.push(centre.clone().sub(n));
  }
  return [...right, ...left.reverse()];
}

/** Nest browns: dark umber under the pile, warm brown, straw-lit tops. */
const NEST_TONES = ["#3d1c0a", "#7a4820", "#bd944f"];
const NEST_TINT: Tint = { edge: [0.66, 0.58, 0.52], hot: [0.05, 0.035, 0.01] };
const BOWL_COLOR = "#2a1206";
const BOWL_TINT: Tint = { edge: [0.75, 0.7, 0.68], hot: [0.03, 0.02, 0.01] };

type Twig = { template: number; x: number; y: number; angle: number; tone: number; z: number };

const NEST_CX = 0.02;

/** Deterministic hash in −0.5…0.5 — the weave must not resample every mount. */
function wobble(i: number, seed: number) {
  const v = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return v - Math.floor(v) - 0.5;
}

type RowSpec = {
  rx: number;
  ry: number;
  cy: number;
  /** Sweep, in degrees, along the lower half of the row's ellipse. */
  from: number;
  to: number;
  count: number;
  templates: number[];
  tones: number[];
  z: number;
  seed: number;
};

/** Clearance a twig keeps from the inner wire so no stick crosses the ring. */
const FIELD_MARGIN = 0.016;

/** Does this twig lie wholly inside the field at this placement? */
function twigFits({ len, halfWidth, bend }: TwigTemplate, x: number, y: number, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let i = 0; i <= 8; i++) {
    const c = twigCentre(len, bend, i / 8);
    if (fieldDepth(x + c.x * cos - c.y * sin, y + c.x * sin + c.y * cos) < halfWidth + FIELD_MARGIN) {
      return false;
    }
  }
  return true;
}

/**
 * A stick that would overhang the oval's inner wire is swapped down the
 * template list until it fits, and dropped if even the shortest will not —
 * which is what tapers the courses off neatly at the flanks.
 */
function fitTwig(twig: Twig): Twig | null {
  let template = twig.template;
  while (template < TWIG_TEMPLATES.length && !twigFits(TWIG_TEMPLATES[template], twig.x, twig.y, twig.angle)) {
    template += 1;
  }
  return template < TWIG_TEMPLATES.length ? { ...twig, template } : null;
}

/**
 * One course of the weave: twigs laid tangent to an elliptical arc, each
 * knocked off true by a little so the row never reads as a machined ring.
 */
function arcRow(spec: RowSpec): Twig[] {
  const twigs: Twig[] = [];
  for (let i = 0; i < spec.count; i++) {
    const t = spec.count === 1 ? 0.5 : i / (spec.count - 1);
    const theta = rad(spec.from + (spec.to - spec.from) * t) + wobble(i, spec.seed) * 0.06;
    const swell = 1 + wobble(i, spec.seed + 5) * 0.1;
    const fitted = fitTwig({
      template: spec.templates[i % spec.templates.length],
      x: NEST_CX + spec.rx * Math.cos(theta) * swell,
      y: spec.cy + spec.ry * Math.sin(theta) * swell,
      angle:
        Math.atan2(spec.ry * Math.cos(theta), -spec.rx * Math.sin(theta)) + wobble(i, spec.seed + 9) * 0.5,
      tone: spec.tones[i % spec.tones.length],
      z: spec.z,
    });
    if (fitted) twigs.push(fitted);
  }
  return twigs;
}

/* Four courses. The two back ones build the far wall and floor of the bowl and
 * sit under the eggs; the two front ones are the near wall and are laid over
 * them, so the front row cuts across the eggs' blunt ends. */
const NEST_TWIGS: Twig[] = [
  ...arcRow({
    rx: 0.6, ry: 0.31, cy: -0.09, from: 188, to: 352, count: 12,
    templates: [0, 2, 1, 3], tones: [0, 1, 0, 2], z: NEST_BACK_Z[0], seed: 1,
  }),
  ...arcRow({
    rx: 0.575, ry: 0.285, cy: -0.105, from: 182, to: 358, count: 10,
    templates: [1, 3, 0, 2], tones: [1, 0, 2, 1], z: NEST_BACK_Z[1], seed: 2,
  }),
  ...arcRow({
    rx: 0.505, ry: 0.215, cy: -0.1, from: 190, to: 350, count: 9,
    templates: [2, 4, 1, 3], tones: [0, 2, 1, 0], z: NEST_BACK_Z[1], seed: 3,
  }),
  ...arcRow({
    rx: 0.58, ry: 0.155, cy: -0.02, from: 182, to: 358, count: 10,
    templates: [0, 2, 1, 3], tones: [2, 1, 0, 1], z: NEST_FRONT_Z[0], seed: 4,
  }),
  ...arcRow({
    rx: 0.55, ry: 0.245, cy: -0.015, from: 190, to: 350, count: 10,
    templates: [1, 2, 0, 3], tones: [1, 2, 0, 2], z: NEST_FRONT_Z[1], seed: 5,
  }),
  /* Loose ends: a few sticks left standing out of the rim on the flanks, the
   * way a real nest never closes neatly — and what carries the weave up into
   * the oval's wide upper corners, which the bowl alone leaves empty. */
  ...(
    [
      { template: 2, x: -0.56, y: -0.02, angle: rad(64), tone: 1, z: NEST_BACK_Z[0] },
      { template: 3, x: -0.5, y: 0.11, angle: rad(44), tone: 2, z: NEST_BACK_Z[1] },
      { template: 4, x: -0.4, y: 0.2, angle: rad(28), tone: 1, z: NEST_BACK_Z[0] },
      { template: 4, x: -0.64, y: -0.14, angle: rad(22), tone: 0, z: NEST_FRONT_Z[0] },
      { template: 2, x: 0.62, y: -0.04, angle: rad(116), tone: 0, z: NEST_BACK_Z[0] },
      { template: 3, x: 0.555, y: 0.11, angle: rad(138), tone: 1, z: NEST_BACK_Z[1] },
      { template: 4, x: 0.45, y: 0.21, angle: rad(154), tone: 2, z: NEST_BACK_Z[0] },
      { template: 4, x: 0.68, y: -0.15, angle: rad(160), tone: 2, z: NEST_FRONT_Z[0] },
    ] as Twig[]
  )
    .map(fitTwig)
    .filter((twig): twig is Twig => twig !== null),
];

/** The dark pile the twigs are woven over, so no field colour shows between. */
function bowlShape(): Shape {
  return polygonShape(
    clampToField(
      [
        ...ellipseArcPoints(NEST_CX, -0.045, 0.55, 0.145, 184, 356, 48),
        ...ellipseArcPoints(NEST_CX, -0.105, 0.62, 0.35, 356, 184, 48),
      ],
      CELL_OUTLINE + FIELD_MARGIN,
    ),
  );
}

/** Twig templates built once, then cloned into place for every placement. */
function useNest() {
  return useMemo(() => {
    const templates = TWIG_TEMPLATES.map(({ len, halfWidth, bend }) => {
      const innerLen = len - 5.2 * CELL_OUTLINE;
      return buildCellFrom(
        polygonShape(twigOutline(len, halfWidth, bend)),
        twigOutline(innerLen, halfWidth - CELL_OUTLINE, (bend * innerLen) / len),
        (halfWidth - CELL_OUTLINE) * 2,
        NEST_TINT,
        8,
        0.03,
      );
    });

    const goldParts: BufferGeometry[] = [];
    const enamelParts: BufferGeometry[][] = NEST_TONES.map(() => []);
    for (const twig of NEST_TWIGS) {
      const template = templates[twig.template];
      goldParts.push(template.gold.clone().rotateZ(twig.angle).translate(twig.x, twig.y, twig.z));
      enamelParts[twig.tone].push(
        template.enamel.clone().rotateZ(twig.angle).translate(twig.x, twig.y, cellEnamelZ(twig.z)),
      );
    }
    templates.forEach(({ gold, enamel }) => {
      gold.dispose();
      enamel.dispose();
    });

    const gold = mergeGeometries(goldParts);
    const enamel = enamelParts.map((parts) => mergeGeometries(parts));
    goldParts.forEach((part) => part.dispose());
    enamelParts.flat().forEach((part) => part.dispose());
    return { gold, enamel };
  }, []);
}

/* ---- Band lettering ----------------------------------------------------- */

/**
 * "HUEVOS" across the top reading clockwise with glyph tops outward;
 * "★ HELD THROUGH IT ALL ★" along the bottom reading left to right with tops
 * inward, the way a medal caption sits; two short rules on the flanks. The
 * glyph treatment — condense, bevel, cap-height centring — is FLOWER BOY's.
 */
function useBandText() {
  const font = useFont(FONT_URL);
  return useMemo(() => {
    const { glyphs, resolution } = font.data;
    const track = ovalTrack(TEXT_OFFSET);
    const pieces: BufferGeometry[] = [];

    // Centre every glyph on the cap height of a reference capital so the
    // baseline sits at a constant offset (glyph bboxes differ per letter).
    const capCentreFor = (size: number) => {
      const probe = extrudeCentered(font.generateShapes("E", size), { depth: 0.01, bevel: 0 });
      probe.computeBoundingBox();
      const centre = (probe.boundingBox!.min.y + probe.boundingBox!.max.y) / 2;
      probe.dispose();
      return centre;
    };

    const lay = (text: string, size: number, centreTheta: number, direction: 1 | -1) => {
      const scale = (size / resolution) * TEXT_CONDENSE;
      const capCentre = capCentreFor(size);
      const chars = [...text];
      const advances = chars.map((char) =>
        char === "★" ? STAR_ADVANCE : (glyphs[char]?.ha ?? glyphs["a"]?.ha ?? 500) * scale,
      );
      const total = advances.reduce((sum, a) => sum + a, 0) + TEXT_TRACKING * (chars.length - 1);
      const s0 = track.sAt(centreTheta);
      let cursor = 0;
      chars.forEach((char, i) => {
        const advance = advances[i];
        if (char !== " ") {
          // Reading direction along the track: clockwise (-s) on top, CCW (+s) below.
          const s = s0 + direction * (cursor + advance / 2 - total / 2);
          const { point, tangent } = track.at(s);
          const angle = Math.atan2(tangent.y * direction, tangent.x * direction);
          let glyph: BufferGeometry;
          if (char === "★") {
            glyph = extrudeCentered(starShape(5, size * 0.27, size * 0.12), {
              depth: TEXT_DEPTH,
              bevel: TEXT_BEVEL,
              curveSegments: 4,
              bevelSegments: 3,
              creaseAngle: Math.PI / 4,
            });
          } else {
            glyph = extrudeCentered(font.generateShapes(char, size), {
              depth: TEXT_DEPTH,
              bevel: TEXT_BEVEL,
              curveSegments: 6,
              bevelSegments: 3,
            });
            glyph.computeBoundingBox();
            const box = glyph.boundingBox!;
            glyph.translate(-(box.min.x + box.max.x) / 2, -capCentre, 0);
            glyph.scale(TEXT_CONDENSE, 1, 1);
          }
          glyph.rotateZ(angle);
          glyph.translate(point.x, point.y, 0);
          pieces.push(glyph);
        }
        cursor += advance + TEXT_TRACKING;
      });
    };

    lay("HUEVOS", TITLE_SIZE, Math.PI / 2, -1);
    lay("★ HELD THROUGH IT ALL ★", CAPTION_SIZE, -Math.PI / 2, 1);

    for (const centre of RULE_CENTERS) {
      const span = RULE_SPAN / 2;
      pieces.push(
        extrudeCentered(ovalRule(TEXT_OFFSET, RULE_THICKNESS, centre - span, centre + span), {
          depth: TEXT_DEPTH,
          bevel: TEXT_BEVEL,
          curveSegments: 8,
          bevelSegments: 3,
        }),
      );
    }

    const merged = mergeGeometries(pieces);
    pieces.forEach((piece) => piece.dispose());
    return merged;
  }, [font]);
}

/* ---- Eggs with motion --------------------------------------------------- */

const EGG_TINT: Tint = { edge: [0.94, 0.8, 0.52], hot: [0.02, 0.02, 0] };
const SHINE_TINT: Tint = { edge: [0.98, 0.95, 0.85], hot: [0, 0, 0] };

type Rock = { angle: number; velocity: number };

const localPoint = new Vector3();

/**
 * One flat enamel egg with its highlight cell. Hovering rocks it a few
 * degrees about the point where it touches the nest, damping out.
 */
function Egg({ spec, pair }: { spec: EggSpec; pair: React.RefObject<Group | null> }) {
  const cells = useMemo(() => {
    const egg = buildCell(eggShape(spec.length, spec.width), spec.width, EGG_TINT, 80);
    const [sx, sy] = spec.shine.at;
    const [rx, ry] = spec.shine.size;
    const shine = buildCell(
      shineShape(rx, ry, spec.shine.tilt, sx * spec.width, sy * spec.length),
      rx * 2,
      SHINE_TINT,
      40,
    );
    return { egg, shine };
  }, [spec]);

  const pivot = useRef<Group>(null);
  const rock = useRef<Rock>({ angle: 0, velocity: 0 });

  // The egg rocks about its lowest point — the blunt end resting in the nest.
  const heading = rad(spec.heading);
  const half = spec.length / 2;
  const pivotAt: [number, number] = [
    spec.centre[0] - Math.cos(heading) * half,
    spec.centre[1] - Math.sin(heading) * half,
  ];

  const kick = (event: ThreeEvent<PointerEvent>) => {
    const group = pivot.current;
    if (!group || !pair.current || pair.current.userData.landed !== true) return;
    group.worldToLocal(localPoint.copy(event.point));
    const side = Math.sign(localPoint.x - (spec.centre[0] - pivotAt[0])) || 1;
    rock.current.velocity += -side * HOVER_KICK;
  };

  useFrame((_, rawDelta) => {
    const r = rock.current;
    const dt = Math.min(rawDelta, 1 / 30);
    r.velocity += (-ROCK_STIFFNESS * r.angle - ROCK_DAMPING * r.velocity) * dt;
    r.angle += r.velocity * dt;
    r.angle = Math.max(-MAX_ROCK, Math.min(MAX_ROCK, r.angle));
    if (Math.abs(r.angle) < 1e-4 && Math.abs(r.velocity) < 1e-3) r.angle = r.velocity = 0;
    if (pivot.current) pivot.current.rotation.z = r.angle;
  });

  return (
    <group ref={pivot} position={[pivotAt[0], pivotAt[1], 0]}>
      <group
        position={[spec.centre[0] - pivotAt[0], spec.centre[1] - pivotAt[1], 0]}
        rotation={[0, 0, heading - Math.PI / 2]}
      >
        <mesh geometry={cells.egg.gold} position={[0, 0, spec.goldZ]} receiveShadow>
          <WallMaterial />
        </mesh>
        <mesh
          geometry={cells.egg.enamel}
          position={[0, 0, cellEnamelZ(spec.goldZ)]}
          receiveShadow
          onPointerOver={kick}
          onPointerDown={kick}
        >
          <SatinEnamelMaterial color={EGG_COLOR} />
        </mesh>
        <mesh geometry={cells.shine.gold} position={[0, 0, SHINE_GOLD_Z]} receiveShadow>
          <WallMaterial />
        </mesh>
        <mesh geometry={cells.shine.enamel} position={[0, 0, cellEnamelZ(SHINE_GOLD_Z)]} receiveShadow>
          <SatinEnamelMaterial color={SHINE_COLOR} envScale={0.4} emissiveIntensity={0.2} />
        </mesh>
      </group>
    </group>
  );
}

type Drop = { y: number; vy: number; delay: number; warm: number; landed: boolean };

/**
 * Both eggs together: on mount they drop in-plane from just above the nest
 * and bounce once or twice into it, then never move again until hovered.
 */
function EggPair() {
  const group = useRef<Group>(null);
  const drop = useRef<Drop>({ y: DROP_HEIGHT, vy: 0, delay: REVEAL_DELAY, warm: 0, landed: false });

  useFrame((_, rawDelta) => {
    const d = drop.current;
    const g = group.current;
    if (!g) return;
    const dt = Math.min(rawDelta, 1 / 30);

    // Hidden until the drop actually begins, so the pair never hangs in the
    // band while the pipeline warms up.
    g.visible = d.warm >= WARMUP_FRAMES && d.delay <= 0;

    if (d.warm < WARMUP_FRAMES) {
      d.warm = rawDelta < WARMUP_SMOOTH_DELTA ? d.warm + 1 : 0;
    } else if (d.delay > 0) {
      d.delay -= dt;
    } else if (!d.landed) {
      d.vy -= GRAVITY * dt;
      d.y += d.vy * dt;
      if (d.y <= 0) {
        d.y = 0;
        if (Math.abs(d.vy) < SETTLE_SPEED) {
          d.vy = 0;
          d.landed = true;
          g.userData.landed = true;
        } else {
          d.vy = -d.vy * RESTITUTION;
        }
      }
    }
    g.position.y = d.y;
  });

  return (
    <group ref={group} position={[0, DROP_HEIGHT, 0]} visible={false}>
      {EGGS.map((spec) => (
        <Egg key={spec.heading} spec={spec} pair={group} />
      ))}
    </group>
  );
}

/* ---- Channel pieces ----------------------------------------------------- */

/** Half-round gold wire following a parallel curve of the oval. */
function useWire([outer, inner]: [number, number]) {
  return useMemo(
    () =>
      extrudeCentered(ovalShape(outer, inner), {
        depth: WIRE_DEPTH,
        bevel: Math.min(WIRE_BEVEL, (inner - outer) / 2 - 0.001),
        curveSegments: 12,
        bevelSegments: 5,
      }),
    [inner, outer],
  );
}

/** Flat gold floor of a channel, set below the wires. */
function useFloor([outer, inner]: [number, number]) {
  return useMemo(
    () =>
      extrudeCentered(ovalShape(outer, inner), {
        depth: FLOOR_DEPTH,
        bevel: FLOOR_BEVEL,
        curveSegments: 12,
        bevelSegments: 2,
      }),
    [inner, outer],
  );
}

/* ------------------------------------------------------------------------ */

/**
 * HUEVOS — "Held through it all." The wide oval of the FLOWER BOY family:
 * the same channel-form gold rim and inner ring (two fine wires over a dark
 * satin floor), the same black band carrying raised lettering, then a deep
 * candy-glass field holding a cloisonné nest — five courses of enamelled
 * twigs woven over a dark pile — with two golden eggs dropped in and cradled
 * behind its front rows.
 *
 * As on the flower medal the reference gold is satin rather than mirror, so
 * the shared settings are re-provided with a rougher metal for this badge.
 */
export function HuevosBadge() {
  const settings = usePinMaterials();
  const satin = useMemo(
    () => ({ ...settings, metalRoughness: Math.max(settings.metalRoughness, 0.2) }),
    [settings],
  );
  return (
    <PinMaterialProvider value={satin}>
      <HuevosBadgeBody />
    </PinMaterialProvider>
  );
}

function HuevosBadgeBody() {
  const { enamelColor } = usePinMaterials();
  const attenuation = useMemo(() => new Color(enamelColor).offsetHSL(-0.01, 0.05, -0.1), [enamelColor]);
  const fieldEmissive = useMemo(() => new Color(enamelColor).offsetHSL(0, 0, -0.12), [enamelColor]);

  const back = useMemo(() => ovalShape(0.02), []);
  const rimOuter = useWire(RIM_WIRE_OUTER);
  const rimInner = useWire(RIM_WIRE_INNER);
  const rimFloor = useFloor(RIM_FLOOR);
  const ringOuter = useWire(RING_WIRE_OUTER);
  const ringInner = useWire(RING_WIRE_INNER);
  const ringFloor = useFloor(RING_FLOOR);
  const bandGeometry = useMemo(
    () =>
      extrudeCentered(ovalShape(BAND[0], BAND[1]), {
        depth: 0.04,
        bevel: 0.004,
        curveSegments: 12,
        bevelSegments: 2,
      }),
    [],
  );

  const fieldGeometry = useMemo(() => {
    const edge: EdgeDistance = fieldDepth;
    const geometry = pourResin(
      buildResinSlab(ovalShape(FIELD_OFFSET - 0.005), FIELD_DEPTH, FIELD_BEVEL, 0.05),
      edge,
      FIELD_SHOULDER,
      0.1,
    );
    return tintResin(geometry, edge, 0.1, [0.72, 0.86, 0.88], [0.04, 0.04, 0.02]);
  }, []);

  const bowl = useMemo(() => buildCell(bowlShape(), 0.5, BOWL_TINT, 64, 0.05), []);
  const nest = useNest();
  const bandText = useBandText();

  const bandZ = RIM_FRONT - ENAMEL_RECESS - 0.02 - 0.004;

  return (
    <group name="huevos-badge">
      <BackPlate shape={back} metal="gold" curveSegments={12} />

      {/* Rim channel: two fine wires over a dark satin floor. */}
      <mesh geometry={rimOuter} position={[0, 0, WIRE_Z]} receiveShadow>
        <AlloyMaterial roughness={WIRE_ROUGHNESS} />
      </mesh>
      <mesh geometry={rimFloor} position={[0, 0, FLOOR_Z]} receiveShadow>
        <FloorMaterial />
      </mesh>
      <mesh geometry={rimInner} position={[0, 0, WIRE_Z]} receiveShadow>
        <AlloyMaterial roughness={WIRE_ROUGHNESS} />
      </mesh>

      {/* Black band with the struck lettering. */}
      <mesh geometry={bandGeometry} position={[0, 0, bandZ]} receiveShadow>
        <BandLacquerMaterial />
      </mesh>
      <mesh geometry={bandText} position={[0, 0, TEXT_Z]} receiveShadow>
        <AlloyMaterial roughness={TEXT_ROUGHNESS} />
      </mesh>

      {/* Inner ring channel. */}
      <mesh geometry={ringOuter} position={[0, 0, WIRE_Z]} receiveShadow>
        <AlloyMaterial roughness={WIRE_ROUGHNESS} />
      </mesh>
      <mesh geometry={ringFloor} position={[0, 0, FLOOR_Z]} receiveShadow>
        <FloorMaterial />
      </mesh>
      <mesh geometry={ringInner} position={[0, 0, WIRE_Z]} receiveShadow>
        <AlloyMaterial roughness={WIRE_ROUGHNESS} />
      </mesh>

      {/* Candy-glass field, meniscus rising against the ring. */}
      <mesh geometry={fieldGeometry} position={[0, 0, FIELD_Z]} receiveShadow>
        <CandyEnamelMaterial
          color={enamelColor}
          vertexColors
          attenuationColor={attenuation}
          attenuationDistance={0.45}
          thickness={0.7}
          emissive={fieldEmissive}
          emissiveIntensity={0.42}
        />
      </mesh>

      {/* The pile the nest is woven over — a dark cell the twigs sit on. */}
      <mesh geometry={bowl.gold} position={[0, 0, BOWL_Z]} receiveShadow>
        <WallMaterial />
      </mesh>
      <mesh geometry={bowl.enamel} position={[0, 0, cellEnamelZ(BOWL_Z)]} receiveShadow>
        <SatinEnamelMaterial color={BOWL_COLOR} envScale={0.35} emissiveIntensity={0.12} />
      </mesh>

      {/* Every twig's wall in one draw call; the enamel grouped by tone. */}
      <mesh geometry={nest.gold} receiveShadow>
        <WallMaterial />
      </mesh>
      {nest.enamel.map((geometry, i) => (
        <mesh key={NEST_TONES[i]} geometry={geometry} receiveShadow>
          <SatinEnamelMaterial color={NEST_TONES[i]} envScale={0.32} emissiveIntensity={0.16} />
        </mesh>
      ))}

      {/* The golden eggs, dropped in behind the front courses. */}
      <EggPair />
    </group>
  );
}
