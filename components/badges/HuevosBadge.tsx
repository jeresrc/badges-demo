"use client";

import { useMemo, useRef } from "react";
import { useFont } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { Color, ExtrudeGeometry, Float32BufferAttribute, Shape, Vector2, Vector3 } from "three";
import type { BufferGeometry, ColorRepresentation, Group } from "three";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CandyEnamelMaterial, MetalMaterial, usePinMaterials } from "./materials";
import { BackPlate, DetailPiece, EnamelPiece, RimPiece } from "./parts";
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

/** Inward offsets from the outer edge, in the order the eye meets them. */
const RIM_INNER = 0.03;
const GROOVE_INNER = 0.056;
const FILLET_INNER = 0.076;
const RING_OUTER = 0.33;
const RING_INNER = 0.355;
const FILL = 0.006;

const TEXT_OFFSET = (FILLET_INNER + RING_OUTER) / 2;
const TITLE_SIZE = 0.2;
const CAPTION_SIZE = 0.14;
const TEXT_CONDENSE = 0.78;
const TEXT_TRACKING = 0.012;
const TEXT_DEPTH = 0.04;
const TEXT_BEVEL = 0.008;
const TEXT_Z = RIM_FRONT - ENAMEL_RECESS - 0.008 + TEXT_DEPTH / 2;
const RULE_THICKNESS = 0.028;
/** Short curved rules on the upper flanks fill the gap between the title and
 * the caption's stars (angles from +X, radians). */
const RULE_SPAN = 0.34;
const RULE_CENTERS = [(34 / 180) * Math.PI, (146 / 180) * Math.PI];
const STAR_ADVANCE = 0.16;

const FONT_URL = "/fonts/typeface.json";

/* Z stack — see FlowerMedal: ExtrudeGeometry caps sit at depth/2 + bevel. */
const topOf = (z: number, depth: number, bevel: number) => z + depth / 2 + bevel;
const enamelZFor = (goldTop: number, depth: number, bevel: number, lift = 0.002) =>
  goldTop + lift - depth / 2 - bevel;

const FIELD_Z = 0.006;
const FIELD_DEPTH = 0.04;
const FIELD_BEVEL = 0.012;
const FIELD_SHOULDER = 0.014;

/* Cloisonné cells share the sunflower's construction exactly: a struck gold
 * wall, an enamel slab inset by the wire width, and a gentle pillow. */
const OUTLINE = 0.01;
const CELL_GOLD_DEPTH = 0.05;
const CELL_GOLD_BEVEL = 0.005;
const CELL_ENAMEL_DEPTH = 0.03;
const CELL_ENAMEL_BEVEL = 0.004;
const CELL_SHOULDER = 0.009;

/** Each layer stands a little prouder than the one it overlaps. */
const NEST_GOLD_Z = 0.04;
const BACK_EGG_GOLD_Z = 0.052;
const FRONT_EGG_GOLD_Z = 0.064;
const SHINE_GOLD_Z = 0.076;

/* ------------------------------------------------------------------------ */
/* The graphic: two golden eggs nestled in a shallow dish.                   */

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
    length: 0.66,
    width: 0.49,
    centre: [-0.17, 0.07],
    heading: 100,
    goldZ: FRONT_EGG_GOLD_Z,
    shine: { at: [-0.22, 0.2], size: [0.06, 0.13], tilt: 22 },
  },
  // Back egg: tucked behind the first, leaning right.
  {
    length: 0.6,
    width: 0.45,
    centre: [0.22, 0.05],
    heading: 78,
    goldZ: BACK_EGG_GOLD_Z,
    shine: { at: [-0.08, 0.27], size: [0.05, 0.11], tilt: 20 },
  },
];

/** Egg profile: widest a little below the middle, closing to a narrower top. */
const EGG_TAPER = 0.17;

/** Shallow dish beneath the eggs: a wide bowl with a slightly lipped rim. */
const NEST = { centre: [0.02, -0.15] as [number, number], width: 1.22, depth: 0.31, rimSag: 0.05 };

const EGG_COLOR = "#f2b232";
const SHINE_COLOR = "#fce9ad";
const NEST_COLOR = "#56220a";

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

/* ------------------------------------------------------------------------ */

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function smooth(t: number) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

const rad = (deg: number) => (deg * Math.PI) / 180;

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

/* ---- Resin (mirrors FlowerMedal) ------------------------------------------ */

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

/** Poured-enamel meniscus rising from the cell wall, with analytic cap normals. */
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

/** Tonal vertex tints: deeper toward the wall, a touch lifted in the middle. */
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

type Tint = { edge: [number, number, number]; hot: [number, number, number] };

/**
 * One cloisonné cell, built the way the sunflower petals are: the outline is
 * struck gold, the enamel is a slab inset by the wire width with a soft
 * pillow rising from the wall. Returns both geometries in the shape's frame.
 */
function buildCell(outline: Shape, width: number, tint: Tint, divisions = 48) {
  const points = outline.getPoints(divisions);
  const cell = offsetPolygon(points, OUTLINE, 3);
  const edge = polygonDistance(cell);
  const gold = extrudeCentered(outline, {
    depth: CELL_GOLD_DEPTH,
    bevel: CELL_GOLD_BEVEL,
    curveSegments: divisions,
    bevelSegments: 3,
  });
  const enamel = tintResin(
    pourResin(
      buildResinSlab(polygonShape(cell), CELL_ENAMEL_DEPTH, CELL_ENAMEL_BEVEL, 0.02),
      edge,
      CELL_SHOULDER,
      width * 0.45,
    ),
    edge,
    width * 0.18,
    tint.edge,
    tint.hot,
  );
  return { gold, enamel };
}

const cellEnamelZ = (goldZ: number) =>
  enamelZFor(topOf(goldZ, CELL_GOLD_DEPTH, CELL_GOLD_BEVEL), CELL_ENAMEL_DEPTH, CELL_ENAMEL_BEVEL);

/* ---- Shapes ------------------------------------------------------------------ */

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

/** Wide shallow dish: a sagging rim over a half-ellipse bowl. */
function nestShape(): Shape {
  const [cx, cy] = NEST.centre;
  const hw = NEST.width / 2;
  const shape = new Shape();
  shape.moveTo(cx - hw, cy);
  shape.quadraticCurveTo(cx, cy - NEST.rimSag * 2, cx + hw, cy);
  shape.absellipse(cx, cy, hw, NEST.depth, 0, -Math.PI, true, 0);
  shape.closePath();
  return shape;
}

/* ---- Band lettering --------------------------------------------------------- */

/**
 * "HUEVOS" across the top reading clockwise with glyph tops outward;
 * "★ HELD THROUGH IT ALL ★" along the bottom reading left to right with tops
 * inward, the way a medal caption sits; two short rules on the upper flanks.
 */
function useBandText() {
  const font = useFont(FONT_URL);
  return useMemo(() => {
    const { glyphs, resolution } = font.data;
    const track = ovalTrack(TEXT_OFFSET);
    const pieces: BufferGeometry[] = [];

    const lay = (text: string, size: number, centreTheta: number, direction: 1 | -1) => {
      const scale = (size / resolution) * TEXT_CONDENSE;
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
            glyph = extrudeCentered(starShape(5, size * 0.36, size * 0.16), {
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
            glyph.translate(-(box.min.x + box.max.x) / 2, -size * 0.36, 0);
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

/* ---- Materials ---------------------------------------------------------------- */

/** Satin hard enamel, same recipe as the sunflower petals. */
function CellMaterial({ color, envScale = 0.75 }: { color: ColorRepresentation; envScale?: number }) {
  const { envMapIntensity } = usePinMaterials();
  return (
    <meshPhysicalMaterial
      color={color}
      vertexColors
      metalness={0}
      roughness={0.42}
      clearcoat={0.8}
      clearcoatRoughness={0.28}
      reflectivity={0.35}
      envMapIntensity={envMapIntensity * envScale}
    />
  );
}

/* ---- Eggs with motion -------------------------------------------------------- */

const EGG_TINT: Tint = { edge: [0.94, 0.8, 0.52], hot: [0.02, 0.02, 0] };
const SHINE_TINT: Tint = { edge: [0.98, 0.95, 0.85], hot: [0, 0, 0] };
const NEST_TINT: Tint = { edge: [0.7, 0.6, 0.55], hot: [0.1, 0.07, 0.02] };

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
          <MetalMaterial metal="gold" />
        </mesh>
        <mesh
          geometry={cells.egg.enamel}
          position={[0, 0, cellEnamelZ(spec.goldZ)]}
          receiveShadow
          onPointerOver={kick}
          onPointerDown={kick}
        >
          <CellMaterial color={EGG_COLOR} />
        </mesh>
        <mesh geometry={cells.shine.gold} position={[0, 0, SHINE_GOLD_Z]} receiveShadow>
          <MetalMaterial metal="gold" />
        </mesh>
        <mesh geometry={cells.shine.enamel} position={[0, 0, cellEnamelZ(SHINE_GOLD_Z)]} receiveShadow>
          <CellMaterial color={SHINE_COLOR} envScale={0.9} />
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

/* ------------------------------------------------------------------------ */

/**
 * HUEVOS — "Held through it all." A wide oval hard-enamel pin in the
 * FLOWER BOY family: gold double-line rim, black band with raised gold
 * lettering, a thin inner ring, then a deep candy-glass field carrying a
 * flat cloisonné graphic of two golden eggs nestled in a dish — every cell
 * outlined in struck gold, the way the sunflower is drawn.
 */
export function HuevosBadge() {
  const { enamelColor } = usePinMaterials();
  const attenuation = useMemo(() => new Color(enamelColor).offsetHSL(-0.01, 0.05, -0.1), [enamelColor]);
  const fieldEmissive = useMemo(() => new Color(enamelColor).offsetHSL(0, 0, -0.12), [enamelColor]);

  const back = useMemo(() => ovalShape(0.025), []);
  const rim = useMemo(() => ovalShape(0, RIM_INNER), []);
  const groove = useMemo(() => ovalShape(RIM_INNER - FILL, GROOVE_INNER + FILL), []);
  const fillet = useMemo(() => ovalShape(GROOVE_INNER, FILLET_INNER), []);
  const band = useMemo(() => ovalShape(FILLET_INNER - FILL, RING_OUTER + FILL), []);
  const ring = useMemo(() => ovalShape(RING_OUTER, RING_INNER), []);

  const fieldGeometry = useMemo(() => {
    // Signed distance to the ring's inner edge along the ellipse normal —
    // exact enough for a parallel curve this far from the foci.
    const edge: EdgeDistance = (x, y) => {
      const theta = Math.atan2(y / B, x / A);
      const p = ellipseOffsetPoint(A, B, RING_INNER, theta);
      const nx = B * Math.cos(theta);
      const ny = A * Math.sin(theta);
      const inv = 1 / Math.hypot(nx, ny);
      return (p.x - x) * nx * inv + (p.y - y) * ny * inv;
    };
    const geometry = pourResin(
      buildResinSlab(ovalShape(RING_INNER - 0.005), FIELD_DEPTH, FIELD_BEVEL, 0.05),
      edge,
      FIELD_SHOULDER,
      0.1,
    );
    return tintResin(geometry, edge, 0.1, [0.62, 0.78, 0.8], [0.04, 0.04, 0.02]);
  }, []);

  const nest = useMemo(() => buildCell(nestShape(), NEST.depth * 2, NEST_TINT, 64), []);
  const bandText = useBandText();

  return (
    <group name="huevos-badge">
      {/* Gold shell: double-line rim with a black groove between the lines. */}
      <BackPlate shape={back} metal="gold" curveSegments={12} />
      <RimPiece shape={rim} metal="gold" curveSegments={12} />
      <EnamelPiece shape={groove} color="#070605" curveSegments={12} />
      <DetailPiece shape={fillet} metal="gold" curveSegments={12} />

      {/* Glossy black band with struck lettering. */}
      <EnamelPiece shape={band} color="#080706" curveSegments={12} />
      <mesh geometry={bandText} position={[0, 0, TEXT_Z]} receiveShadow>
        <MetalMaterial metal="gold" />
      </mesh>
      <DetailPiece shape={ring} metal="gold" curveSegments={12} />

      {/* Candy-glass field, meniscus rising against the ring. */}
      <mesh geometry={fieldGeometry} position={[0, 0, FIELD_Z]} receiveShadow>
        <CandyEnamelMaterial
          color={enamelColor}
          vertexColors
          attenuationColor={attenuation}
          attenuationDistance={0.45}
          thickness={0.7}
          emissive={fieldEmissive}
          emissiveIntensity={0.15}
        />
      </mesh>

      {/* The nest: a dark chocolate dish in a fine gold wire, like the seed head. */}
      <mesh geometry={nest.gold} position={[0, 0, NEST_GOLD_Z]} receiveShadow>
        <MetalMaterial metal="gold" />
      </mesh>
      <mesh geometry={nest.enamel} position={[0, 0, cellEnamelZ(NEST_GOLD_Z)]} receiveShadow>
        <CellMaterial color={NEST_COLOR} envScale={0.5} />
      </mesh>

      {/* The golden eggs. */}
      <EggPair />
    </group>
  );
}
