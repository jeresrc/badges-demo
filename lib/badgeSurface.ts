import { Color, Matrix4, Vector3 } from "three";
import type { BufferGeometry, Material, Mesh, Object3D } from "three";

/**
 * Badge → point-cloud sampling.
 *
 * The transition needs, for every particle, a point on the badge's *surface*
 * plus the colour of the material it came from, expressed in the badge root's
 * local space so the cloud can live next to the badges inside the swaying
 * stage and still line up with them exactly.
 *
 * Why not `MeshSurfaceSampler` (three/examples): it builds one cumulative-area
 * table per geometry, and a badge is 30+ meshes (rim, plates, petals, one mesh
 * per Text3D glyph). Weighting *between* those meshes would then have to be
 * invented on top, and a big flat back plate (2 triangles, huge area) would
 * either drown out or lose to a bevelled glyph (thousands of tiny triangles).
 *
 * Instead the walk below treats the whole badge as one surface: it sums the
 * area of every triangle in the subtree, then makes a second pass emitting
 * `count * area_i / totalArea` points per triangle, carrying the fractional
 * remainder forward. That is exact area-weighted sampling across the entire
 * badge, in O(triangles) time with no cumulative table and no per-call
 * allocation — everything is written straight into caller-owned buffers.
 */

export type BadgeSample = {
  /** Surface positions in badge-root space, xyz per particle. */
  positions: Float32Array;
  /** Linear-space RGB per particle, derived from the source material. */
  colors: Float32Array;
  /** How many particles were actually written. */
  count: number;
};

/** Hot ember the palette collapses to; dark materials get lifted towards it. */
export const EMBER = /* @__PURE__ */ new Color("#ff5a12").convertSRGBToLinear();
/** Struck-gold accent mixed into a few percent of the cloud for sparkle. */
const GOLD = /* @__PURE__ */ new Color("#ffc85c").convertSRGBToLinear();

const rootInv = /* @__PURE__ */ new Matrix4();
const local = /* @__PURE__ */ new Matrix4();
const a = /* @__PURE__ */ new Vector3();
const b = /* @__PURE__ */ new Vector3();
const c = /* @__PURE__ */ new Vector3();
const ab = /* @__PURE__ */ new Vector3();
const ac = /* @__PURE__ */ new Vector3();
const p = /* @__PURE__ */ new Vector3();
const tint = /* @__PURE__ */ new Color();

type Entry = { geometry: BufferGeometry | null; matrix: Matrix4; color: Color };

/** Reused between calls; entries are overwritten, never re-allocated per call. */
const entries: Entry[] = [];
let entryCount = 0;

function pushEntry(geometry: BufferGeometry, matrix: Matrix4, color: Color) {
  let entry = entries[entryCount];
  if (!entry) {
    entry = { geometry, matrix: new Matrix4(), color: new Color() };
    entries[entryCount] = entry;
  }
  entry.geometry = geometry;
  entry.matrix.copy(matrix);
  entry.color.copy(color);
  entryCount++;
}

/**
 * The particle colour for one material. Metals and enamel hand over their own
 * albedo (which is the project palette: gold, chrome-white, hot orange), while
 * the light-drinking materials — piano lacquer, velvet, kraft paper — would
 * only contribute invisible black dust, so they are lifted towards ember.
 */
function particleTint(material: Material | Material[] | null): Color {
  const mat = (Array.isArray(material) ? material[0] : material) as
    | (Material & { color?: Color })
    | null;
  const source = mat?.color;
  if (!source) return tint.copy(EMBER);

  tint.copy(source);
  const lum = tint.r * 0.2126 + tint.g * 0.7152 + tint.b * 0.0722;
  if (lum < 0.02) return tint.copy(EMBER).multiplyScalar(0.55);
  if (lum < 0.12) return tint.lerp(EMBER, 0.7);
  return tint;
}

function triangleArea(): number {
  ab.subVectors(b, a);
  ac.subVectors(c, a);
  return ab.cross(ac).length() * 0.5;
}

/** Uniform point in the current triangle (sqrt keeps the distribution even). */
function randomPointInTriangle(): Vector3 {
  let u = Math.random();
  let v = Math.random();
  if (u + v > 1) {
    u = 1 - u;
    v = 1 - v;
  }
  return p
    .copy(a)
    .addScaledVector(ab.subVectors(b, a), u)
    .addScaledVector(ac.subVectors(c, a), v);
}

function readTriangle(geometry: BufferGeometry, i0: number, i1: number, i2: number, matrix: Matrix4) {
  const pos = geometry.attributes.position;
  a.fromBufferAttribute(pos, i0).applyMatrix4(matrix);
  b.fromBufferAttribute(pos, i1).applyMatrix4(matrix);
  c.fromBufferAttribute(pos, i2).applyMatrix4(matrix);
}

/**
 * Fills `out` with `count` surface points sampled from every mesh under
 * `root`. Returns false when the subtree has no drawable triangles yet (a
 * Text3D still resolving its font, for instance) so the caller can retry or
 * fall back.
 */
export function sampleBadgeSurface(root: Object3D, count: number, out: BadgeSample): boolean {
  root.updateWorldMatrix(true, true);
  rootInv.copy(root.matrixWorld).invert();

  entryCount = 0;
  let totalArea = 0;

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const geometry = mesh.geometry;
    const position = geometry?.attributes?.position;
    if (!position) return;

    local.multiplyMatrices(rootInv, mesh.matrixWorld);
    pushEntry(geometry, local, particleTint(mesh.material));
  });

  // Pass 1 — total surface area of the whole badge.
  for (let e = 0; e < entryCount; e++) {
    const { geometry, matrix } = entries[e];
    if (!geometry) continue;
    const index = geometry.index;
    const triangles = index ? index.count / 3 : geometry.attributes.position.count / 3;
    for (let t = 0; t < triangles; t++) {
      const i = t * 3;
      if (index) {
        readTriangle(geometry, index.getX(i), index.getX(i + 1), index.getX(i + 2), matrix);
      } else {
        readTriangle(geometry, i, i + 1, i + 2, matrix);
      }
      totalArea += triangleArea();
    }
  }

  if (totalArea <= 0) {
    releaseEntries();
    out.count = 0;
    return false;
  }

  // Pass 2 — emit points, area-weighted, carrying the remainder forward.
  const perArea = count / totalArea;
  let written = 0;
  let credit = 0;

  for (let e = 0; e < entryCount && written < count; e++) {
    const { geometry, matrix, color } = entries[e];
    if (!geometry) continue;
    const index = geometry.index;
    const triangles = index ? index.count / 3 : geometry.attributes.position.count / 3;

    for (let t = 0; t < triangles && written < count; t++) {
      const i = t * 3;
      if (index) {
        readTriangle(geometry, index.getX(i), index.getX(i + 1), index.getX(i + 2), matrix);
      } else {
        readTriangle(geometry, i, i + 1, i + 2, matrix);
      }
      credit += triangleArea() * perArea;

      while (credit >= 1 && written < count) {
        credit -= 1;
        const point = randomPointInTriangle();
        const o = written * 3;
        out.positions[o] = point.x;
        out.positions[o + 1] = point.y;
        out.positions[o + 2] = point.z;

        // Per-particle brightness jitter plus an occasional gold fleck: the
        // cloud reads as embers of the badge rather than a flat colour field.
        const jitter = 0.55 + Math.random() * 0.9;
        const fleck = Math.random() < 0.06 ? 0.55 : 0;
        out.colors[o] = (color.r + (GOLD.r - color.r) * fleck) * jitter;
        out.colors[o + 1] = (color.g + (GOLD.g - color.g) * fleck) * jitter;
        out.colors[o + 2] = (color.b + (GOLD.b - color.b) * fleck) * jitter;
        written++;
      }
    }
  }

  // Rounding can leave the tail short by a handful of particles; repeat the
  // last point rather than shipping uninitialised memory to the GPU.
  while (written < count && written > 0) {
    const o = written * 3;
    const prev = o - 3;
    out.positions[o] = out.positions[prev];
    out.positions[o + 1] = out.positions[prev + 1];
    out.positions[o + 2] = out.positions[prev + 2];
    out.colors[o] = out.colors[prev];
    out.colors[o + 1] = out.colors[prev + 1];
    out.colors[o + 2] = out.colors[prev + 2];
    written++;
  }

  releaseEntries();
  out.count = written;
  return written > 0;
}

/** Drops the geometry references so unmounted badges can be collected. */
function releaseEntries() {
  for (let e = 0; e < entryCount; e++) entries[e].geometry = null;
  entryCount = 0;
}

/**
 * Fallback cloud: a soft shell roughly the size of a badge. Used only if a
 * badge's geometry is not ready in time (first-ever font load), so particles
 * still have somewhere coherent to go.
 */
export function fillFallbackCloud(count: number, out: BadgeSample) {
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = 1.05 * (0.75 + Math.random() * 0.25);
    const s = Math.sqrt(1 - u * u);
    out.positions[o] = Math.cos(theta) * s * r;
    out.positions[o + 1] = Math.sin(theta) * s * r;
    out.positions[o + 2] = u * r * 0.25;
    const jitter = 0.5 + Math.random();
    out.colors[o] = EMBER.r * jitter;
    out.colors[o + 1] = EMBER.g * jitter;
    out.colors[o + 2] = EMBER.b * jitter;
  }
  out.count = count;
}
