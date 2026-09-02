"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFont } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import {
  Color,
  DataTexture,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  Shape,
  Vector2,
  Vector3,
} from "three";
import type { BufferGeometry, Group, Mesh } from "three";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CandyEnamelMaterial, MetalMaterial, usePinMaterials } from "./materials";
import { BackPlate, DetailPiece, EnamelPiece, RimPiece } from "./parts";
import {
  ENAMEL_RECESS,
  PIN_HALF_SIZE,
  RIM_FRONT,
  extrudeCentered,
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

const FONT_URL = "/fonts/typeface.json";

/* Z stack — see FlowerMedal: ExtrudeGeometry caps sit at depth/2 + bevel. */
const topOf = (z: number, depth: number, bevel: number) => z + depth / 2 + bevel;

const FIELD_Z = 0.006;
const FIELD_DEPTH = 0.04;
const FIELD_BEVEL = 0.012;
const FIELD_SHOULDER = 0.016;
const FIELD_TOP = topOf(FIELD_Z, FIELD_DEPTH, FIELD_BEVEL);
const DISH_DEPTH = 0.03;

/* ------------------------------------------------------------------------ */
/* The eggs                                                                 */

type EggSpec = {
  length: number;
  width: number;
  centre: [number, number];
  /** Direction of the narrow end, degrees from +X. */
  heading: number;
  /** Reveal delay so the pair does not land as one. */
  delay: number;
  seed: number;
};

/** Two real eggs: one a touch larger, lying blunt-end to blunt-end in a nest. */
const EGGS: EggSpec[] = [
  { length: 0.53, width: 0.39, centre: [-0.245, 0.02], heading: 151, delay: 0, seed: 3 },
  { length: 0.49, width: 0.365, centre: [0.25, -0.01], heading: 24, delay: 0.09, seed: 11 },
];

/** Egg profile: widest a little below the middle, closing to a narrower top. */
const EGG_TAPER = 0.17;
const EGG_PROFILE_STEPS = 44;
const EGG_SEGMENTS = 72;

/* Motion. */
const DROP_HEIGHT = 0.6;
const GRAVITY = 6;
const RESTITUTION = 0.34;
const SETTLE_SPEED = 0.28;
/** Frames must be flowing smoothly for this long before the reveal starts —
 * on first paint the GPU is still compiling shaders and nothing is presented,
 * so a drop that started at mount would be over before anyone saw it. */
const WARMUP_FRAMES = 4;
const WARMUP_SMOOTH_DELTA = 0.05;
const REVEAL_DELAY = 0.35;
const PITCH_STIFFNESS = 120;
const PITCH_DAMPING = 6.5;
const YAW_STIFFNESS = 90;
const YAW_DAMPING = 7;
const HOVER_KICK = 1.4;
const MAX_TILT = 0.12;

/* ------------------------------------------------------------------------ */

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function smooth(t: number) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Deterministic PRNG so the speckle pattern never changes between renders. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

function ellipseOffsetPoints(a: number, b: number, d: number, count = 192, from = 0, to = Math.PI * 2): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i < count; i++) {
    const theta = from + ((to - from) * i) / (count - 1);
    points.push(ellipseOffsetPoint(a, b, d, theta));
  }
  return points;
}

/** Closed parallel curve as a shape, optionally with a parallel-curve hole. */
function ovalShape(outerOffset: number, innerOffset?: number): Shape {
  const outer = ellipseOffsetPoints(A, B, outerOffset, 192, 0, Math.PI * 2 * (1 - 1 / 192));
  const inner =
    innerOffset === undefined
      ? undefined
      : ellipseOffsetPoints(A, B, innerOffset, 192, 0, Math.PI * 2 * (1 - 1 / 192));
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

/* ---- Resin ---------------------------------------------------------------- */

type HeightField = (x: number, y: number) => number;

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
  const tessellated = new TessellateModifier(tessellation, 14).modify(geometry);
  geometry.dispose();
  tessellated.deleteAttribute("normal");
  tessellated.deleteAttribute("uv");
  return mergeVertices(tessellated, 1e-4);
}

/**
 * Displace the front cap by an arbitrary height field (meniscus rising to the
 * wall, dishes sinking under the eggs) with analytic cap normals so the
 * tessellation never shows as facets.
 */
function displaceCap(geometry: BufferGeometry, height: HeightField) {
  const position = geometry.attributes.position;
  let zFront = -Infinity;
  for (let i = 0; i < position.count; i++) zFront = Math.max(zFront, position.getZ(i));
  const onCap: boolean[] = new Array(position.count);
  for (let i = 0; i < position.count; i++) onCap[i] = position.getZ(i) > zFront - 1e-3;

  for (let i = 0; i < position.count; i++) {
    position.setZ(i, position.getZ(i) + height(position.getX(i), position.getY(i)));
  }
  geometry.computeVertexNormals();

  const normal = geometry.attributes.normal;
  const eps = 0.004;
  for (let i = 0; i < position.count; i++) {
    if (!onCap[i]) continue;
    const x = position.getX(i);
    const y = position.getY(i);
    const dx = (height(x + eps, y) - height(x - eps, y)) / (2 * eps);
    const dy = (height(x, y + eps) - height(x, y - eps)) / (2 * eps);
    const inv = 1 / Math.hypot(dx, dy, 1);
    normal.setXYZ(i, -dx * inv, -dy * inv, inv);
  }
  normal.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

/** Normalised elliptical radius of (x, y) inside the dish under an egg. */
function dishRadius(spec: EggSpec, x: number, y: number) {
  const heading = rad(spec.heading);
  const dx = x - spec.centre[0];
  const dy = y - spec.centre[1];
  const along = dx * Math.cos(heading) + dy * Math.sin(heading);
  const across = -dx * Math.sin(heading) + dy * Math.cos(heading);
  const ra = (spec.length / 2) * 0.86;
  const rb = (spec.width / 2) * 0.92;
  return Math.hypot(along / ra, across / rb);
}

/* ---- Egg geometry ---------------------------------------------------------- */

/**
 * Real egg: a lathe of the classic asymmetric profile, then a whisper of
 * low-frequency unevenness so neither egg is a perfect solid of revolution.
 */
function buildEgg(length: number, width: number, seed: number): BufferGeometry {
  const profile: Vector2[] = [];
  for (let i = 0; i <= EGG_PROFILE_STEPS; i++) {
    const t = -Math.cos((i / EGG_PROFILE_STEPS) * Math.PI); // -1 .. 1, dense at the poles
    const r = Math.sqrt(Math.max(0, 1 - t * t)) * (1 - EGG_TAPER * t);
    profile.push(new Vector2((r * width) / 2, (t * length) / 2));
  }
  profile[0].x = 0;
  profile[EGG_PROFILE_STEPS].x = 0;

  const geometry = new LatheGeometry(profile, EGG_SEGMENTS);
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const random = mulberry32(seed);
  const phase1 = random() * Math.PI * 2;
  const phase2 = random() * Math.PI * 2;
  const amount = width * 0.006;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const phi = Math.atan2(z, x);
    const v = (y / (length / 2)) * Math.PI;
    const wobble = Math.sin(phi + phase1) * Math.cos(v * 0.5) + 0.5 * Math.sin(2 * phi + phase2 + v);
    const d = amount * wobble * Math.max(0, 1 - Math.abs(y / (length / 2)) ** 3);
    position.setXYZ(i, x + normal.getX(i) * d, y + normal.getY(i) * d, z + normal.getZ(i) * d);
  }
  geometry.computeVertexNormals();
  // Lathe seam: the first and last column are the same points — share normals.
  const columns = profile.length;
  const n = geometry.attributes.normal;
  for (let j = 0; j < columns; j++) {
    const a = j;
    const b = EGG_SEGMENTS * columns + j;
    const nx = n.getX(a) + n.getX(b);
    const ny = n.getY(a) + n.getY(b);
    const nz = n.getZ(a) + n.getZ(b);
    const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
    n.setXYZ(a, nx * inv, ny * inv, nz * inv);
    n.setXYZ(b, nx * inv, ny * inv, nz * inv);
  }
  n.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Shell speckle as a texture rather than a shader patch (the transition
 * already owns `onBeforeCompile`). R carries a bump height, G a roughness
 * multiplier: tiny pits and flecks scatter the highlight the way a real shell
 * — or a cast-and-brushed gold one — breaks up a mirror reflection.
 */
function buildSpeckleTexture(seed: number): DataTexture {
  const W = 512;
  const H = 256;
  const data = new Uint8Array(W * H * 4);
  const random = mulberry32(seed);

  const bump = new Float32Array(W * H).fill(0.5);
  const rough = new Float32Array(W * H).fill(0.72);

  // Fine grain everywhere.
  for (let i = 0; i < W * H; i++) {
    const g = (random() - 0.5) * 0.06;
    bump[i] += g * 0.5;
    rough[i] += g;
  }

  // Speckles: many tiny, a few larger and softer.
  const count = 2600;
  for (let k = 0; k < count; k++) {
    const cx = random() * W;
    const cy = random() * H;
    const large = random() < 0.12;
    const radius = large ? 1.6 + random() * 2.2 : 0.6 + random() * 1.1;
    const depth = (large ? 0.16 : 0.26) * (0.6 + random() * 0.4);
    const roughBoost = large ? 0.22 : 0.3;
    const r2 = Math.ceil(radius) + 1;
    for (let dy = -r2; dy <= r2; dy++) {
      for (let dx = -r2; dx <= r2; dx++) {
        const px = (((Math.floor(cx) + dx) % W) + W) % W;
        const py = (((Math.floor(cy) + dy) % H) + H) % H;
        const dist = Math.hypot(Math.floor(cx) + dx + 0.5 - cx, Math.floor(cy) + dy + 0.5 - cy);
        const f = 1 - smooth(dist / radius);
        if (f <= 0) continue;
        const idx = py * W + px;
        bump[idx] -= depth * f;
        rough[idx] = Math.min(1, rough[idx] + roughBoost * f);
      }
    }
  }

  for (let i = 0; i < W * H; i++) {
    data[i * 4] = Math.round(clamp01(bump[i]) * 255);
    data[i * 4 + 1] = Math.round(clamp01(rough[i]) * 255);
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }

  const texture = new DataTexture(data, W, H);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/* ---- Band lettering --------------------------------------------------------- */

const STAR_ADVANCE = 0.16;

/**
 * "HUEVOS" across the top reading clockwise with glyph tops outward;
 * "★ HELD THROUGH IT ALL ★" along the bottom reading left to right with tops
 * inward, the way a medal caption sits; two short rules on the flanks.
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
          const tx = tangent.x * direction;
          const ty = tangent.y * direction;
          const angle = Math.atan2(ty, tx);
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

/* ---- Eggs with motion -------------------------------------------------------- */

type EggMotion = {
  z: number;
  vz: number;
  pitch: number;
  vPitch: number;
  yaw: number;
  vYaw: number;
  delay: number;
  warm: number;
  landed: boolean;
};

const localPoint = new Vector3();

/**
 * One golden egg in its dish. Idle it is perfectly still; on hover it rocks
 * gently about its resting point and damps out; on mount it drops from just
 * above and bounces once or twice into place.
 */
function Egg({ spec, restZ, speckle }: { spec: EggSpec; restZ: number; speckle: DataTexture }) {
  const { envMapIntensity } = usePinMaterials();
  const geometry = useMemo(() => buildEgg(spec.length, spec.width, spec.seed), [spec]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const outer = useRef<Group>(null);
  const inner = useRef<Mesh>(null);
  const motion = useRef<EggMotion>({
    z: DROP_HEIGHT,
    vz: 0,
    pitch: 0,
    vPitch: 0,
    yaw: 0,
    vYaw: 0,
    delay: REVEAL_DELAY + spec.delay,
    warm: 0,
    landed: false,
  });
  const random = useRef(mulberry32(spec.seed * 7919));

  const kick = (event: ThreeEvent<PointerEvent>) => {
    const mesh = inner.current;
    const m = motion.current;
    if (!mesh || !m.landed) return;
    // Which end was touched decides which way the egg dips.
    mesh.worldToLocal(localPoint.copy(event.point));
    const end = Math.sign(localPoint.y) || 1;
    const side = Math.sign(localPoint.x) || 1;
    m.vPitch += -end * HOVER_KICK * (0.8 + 0.4 * random.current());
    m.vYaw += side * HOVER_KICK * 0.35 * (0.7 + 0.6 * random.current());
  };

  useFrame((_, rawDelta) => {
    const m = motion.current;
    const dt = Math.min(rawDelta, 1 / 30);
    if (!outer.current || !inner.current) return;

    if (m.warm < WARMUP_FRAMES) {
      m.warm = rawDelta < WARMUP_SMOOTH_DELTA ? m.warm + 1 : 0;
    } else if (m.delay > 0) {
      m.delay -= dt;
    } else if (!m.landed) {
      m.vz -= GRAVITY * dt;
      m.z += m.vz * dt;
      if (m.z <= 0) {
        m.z = 0;
        if (Math.abs(m.vz) < SETTLE_SPEED) {
          m.vz = 0;
          m.landed = true;
        } else {
          m.vz = -m.vz * RESTITUTION;
          // A little rock on impact, alternating ends.
          const dir = random.current() < 0.5 ? -1 : 1;
          m.vPitch += dir * Math.abs(m.vz) * 1.1;
          m.vYaw += (random.current() - 0.5) * Math.abs(m.vz) * 0.6;
        }
      }
    }

    // Damped rocking springs (semi-implicit Euler).
    m.vPitch += (-PITCH_STIFFNESS * m.pitch - PITCH_DAMPING * m.vPitch) * dt;
    m.pitch += m.vPitch * dt;
    m.vYaw += (-YAW_STIFFNESS * m.yaw - YAW_DAMPING * m.vYaw) * dt;
    m.yaw += m.vYaw * dt;
    m.pitch = Math.max(-MAX_TILT, Math.min(MAX_TILT, m.pitch));
    m.yaw = Math.max(-MAX_TILT, Math.min(MAX_TILT, m.yaw));
    if (m.landed && Math.abs(m.pitch) < 1e-4 && Math.abs(m.vPitch) < 1e-3) m.pitch = m.vPitch = 0;
    if (m.landed && Math.abs(m.yaw) < 1e-4 && Math.abs(m.vYaw) < 1e-3) m.yaw = m.vYaw = 0;

    // Rocking happens about the contact point, so the lifted end rises and the
    // other never sinks into the enamel.
    const lift = Math.abs(Math.sin(m.pitch)) * (spec.length / 2) * 0.45;
    outer.current.position.z = restZ + m.z + lift;
    outer.current.rotation.z = rad(spec.heading) - Math.PI / 2 + m.yaw;
    inner.current.rotation.x = m.pitch;
  });

  return (
    <group ref={outer} position={[spec.centre[0], spec.centre[1], restZ]}>
      <mesh
        ref={inner}
        geometry={geometry}
        castShadow
        receiveShadow
        onPointerOver={kick}
        onPointerDown={kick}
      >
        {/* Warm yellow gold: satin body with pit-speckled roughness so it reads
            as a heavy cast object, not a chrome balloon. */}
        <meshStandardMaterial
          color="#f6b64c"
          metalness={1}
          roughness={0.27}
          roughnessMap={speckle}
          bumpMap={speckle}
          bumpScale={0.004}
          envMapIntensity={envMapIntensity * 1.1}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * HUEVOS — "Held through it all." A wide oval hard-enamel pin in the
 * FLOWER BOY family: gold double-line rim, black band with raised gold
 * lettering, a thin inner ring, then a deep candy-glass field holding two
 * golden eggs in shallow dishes. The eggs are the hero: heavy, warm,
 * speckled, and they never crack.
 */
export function HuevosBadge() {
  const { enamelColor } = usePinMaterials();
  const attenuation = useMemo(
    () => new Color(enamelColor).offsetHSL(-0.01, 0.05, -0.1),
    [enamelColor],
  );

  const back = useMemo(() => ovalShape(0.025), []);
  const rim = useMemo(() => ovalShape(0, RIM_INNER), []);
  const groove = useMemo(() => ovalShape(RIM_INNER - FILL, GROOVE_INNER + FILL), []);
  const fillet = useMemo(() => ovalShape(GROOVE_INNER, FILLET_INNER), []);
  const band = useMemo(() => ovalShape(FILLET_INNER - FILL, RING_OUTER + FILL), []);
  const ring = useMemo(() => ovalShape(RING_OUTER, RING_INNER), []);

  const fieldGeometry = useMemo(() => {
    // Signed distance to the ring's inner edge along the ellipse normal —
    // exact enough for a parallel curve this far from the foci.
    const edge = (x: number, y: number) => {
      const theta = Math.atan2(y / B, x / A);
      const p = ellipseOffsetPoint(A, B, RING_INNER, theta);
      const nx = B * Math.cos(theta);
      const ny = A * Math.sin(theta);
      const inv = 1 / Math.hypot(nx, ny);
      return (p.x - x) * nx * inv + (p.y - y) * ny * inv;
    };
    const height = (x: number, y: number) => {
      let h = FIELD_SHOULDER * smooth(edge(x, y) / 0.1);
      for (const spec of EGGS) {
        const r = dishRadius(spec, x, y);
        h -= DISH_DEPTH * smooth(1 - r);
      }
      return h;
    };
    const geometry = displaceCap(buildResinSlab(ovalShape(RING_INNER - 0.005), FIELD_DEPTH, FIELD_BEVEL, 0.022), height);

    // Tonal tint: deeper toward the wall and into the dishes where the glass
    // is thickest, a touch lifted in the open field.
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const wallTint = [0.62, 0.78, 0.8];
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const wall = 1 - smooth(edge(x, y) / 0.1);
      let dish = 0;
      for (const spec of EGGS) dish = Math.max(dish, smooth(1 - dishRadius(spec, x, y)));
      const dark = Math.max(wall, dish * 0.85);
      const hot = (1 - dark) * 0.04;
      colors[i * 3] = 1 + (wallTint[0] - 1) * dark + hot;
      colors[i * 3 + 1] = 1 + (wallTint[1] - 1) * dark + hot;
      colors[i * 3 + 2] = 1 + (wallTint[2] - 1) * dark + hot * 0.5;
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    return geometry;
  }, []);

  const speckle = useMemo(() => buildSpeckleTexture(1337), []);
  useEffect(() => () => speckle.dispose(), [speckle]);

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

      {/* Candy-glass field with two dishes sunk into it. */}
      <mesh geometry={fieldGeometry} position={[0, 0, FIELD_Z]} receiveShadow>
        <CandyEnamelMaterial
          color={enamelColor}
          vertexColors
          attenuationColor={attenuation}
          attenuationDistance={0.4}
          thickness={0.85}
        />
      </mesh>

      {/* The golden eggs, each resting at the bottom of its dish. */}
      {EGGS.map((spec) => (
        <Egg
          key={spec.seed}
          spec={spec}
          speckle={speckle}
          restZ={FIELD_TOP - DISH_DEPTH + spec.width / 2 - 0.004}
        />
      ))}
    </group>
  );
}
