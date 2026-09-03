import { ExtrudeGeometry, Float32BufferAttribute, Shape, Vector2 } from "three";
import type { BufferGeometry } from "three";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RIM_FRONT } from "./shapes";

/**
 * The cloisonné construction shared by the FLOWER BOY and HUEVOS pins so the
 * two read as siblings from one pin set: a channel-form gold edge (two fine
 * half-round wires over a recessed dark floor) and cells built as a struck
 * gold wall with a poured, pillowed enamel slab set inside it.
 *
 * Proportions were measured off refs/flower-medal.jpg; the numbers here are
 * the quality bar every other badge in the family is matched against.
 */

/* ---- Z stack ------------------------------------------------------------ */

/**
 * `ExtrudeGeometry` places its caps at ±(depth / 2 + bevel) once the geometry
 * is centred, so a piece's visible front face is never simply its position.
 */
export const topOf = (z: number, depth: number, bevel: number) => z + depth / 2 + bevel;

/** Enamel slab centre so its flat cap sits `lift` above a gold cap at `goldTop`. */
export const enamelZFor = (goldTop: number, depth: number, bevel: number, lift = 0.002) =>
  goldTop + lift - depth / 2 - bevel;

/* ---- Channel edge ------------------------------------------------------- */

export const WIRE_DEPTH = 0.05;
/** Wires are half-round: bevel ≈ half the width so the crest is a rounded ridge. */
export const WIRE_BEVEL = 0.004;
export const WIRE_Z = RIM_FRONT - WIRE_DEPTH / 2 - WIRE_BEVEL;
export const FLOOR_DEPTH = 0.03;
export const FLOOR_BEVEL = 0.003;
/**
 * Floors meet the wires just under their crests: the lower half of a
 * half-round wire would otherwise reflect the black horizon as a dark line.
 */
export const FLOOR_Z = RIM_FRONT - 0.016 - FLOOR_DEPTH / 2;

/** Polished wire: a mirror crest that picks the frontal card up as one line. */
export const WIRE_ROUGHNESS = 0.1;
/** Cast lettering: satin, so the faces average the room to a mid tan. */
export const TEXT_ROUGHNESS = 0.25;

/* ---- Cells -------------------------------------------------------------- */

/** Visible gold cloisonné outline around every enamel cell. */
export const CELL_OUTLINE = 0.008;
export const CELL_GOLD_DEPTH = 0.05;
export const CELL_GOLD_BEVEL = 0.005;
export const CELL_ENAMEL_DEPTH = 0.03;
export const CELL_ENAMEL_BEVEL = 0.004;

/** Enamel slab centre for a cell whose gold wall is centred on `goldZ`. */
export const cellEnamelZ = (goldZ: number) =>
  enamelZFor(topOf(goldZ, CELL_GOLD_DEPTH, CELL_GOLD_BEVEL), CELL_ENAMEL_DEPTH, CELL_ENAMEL_BEVEL);

/* ---- Small maths -------------------------------------------------------- */

export function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

export function smooth(t: number) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

export const rad = (deg: number) => (deg * Math.PI) / 180;

/* ---- Poured resin ------------------------------------------------------- */

export type EdgeDistance = (x: number, y: number) => number;

/** Distance from (x, y) to the nearest edge of a closed polygon. */
export function polygonDistance(points: Vector2[]): EdgeDistance {
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
export function buildResinSlab(
  shape: Shape,
  depth: number,
  bevel: number,
  tessellation: number,
): BufferGeometry {
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
export function pourResin(
  geometry: BufferGeometry,
  edge: EdgeDistance,
  shoulder: number,
  meniscus: number,
) {
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

export type Tint = { edge: [number, number, number]; hot: [number, number, number] };

/**
 * Tonal vertex tints multiplied into the enamel colour: the body deepens
 * toward the cell wall where the glass is thickest, and lifts a touch toward
 * the centre where light escapes the pour most directly.
 */
export function tintResin(
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
