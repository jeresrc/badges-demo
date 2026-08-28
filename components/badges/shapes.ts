import { ExtrudeGeometry, Path, Shape, Vector2 } from "three";
import type { BufferGeometry } from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Shared physical proportions for every pin variant so that all badges have the
 * same bounding size, sit at the origin and face +Z. The pin is built the way a
 * real die-struck pin is: a rim/wall lattice around open cavities, a thin plate
 * closing the back, and enamel poured into the cavities just below the metal.
 *
 * Z layout (extruded geometry is centred on z = 0, then offset):
 *
 *   +0.050  RIM_FRONT ................ flat front face of every raised metal area
 *   +0.022  RIM_FRONT - RECESS ....... surface of the enamel in the cavity
 *   -0.010  back plate front face ..... floor of the cavity (enamel sits on it)
 *   -0.050 -RIM_FRONT ................ flat back face of the rim
 */
export const PIN_HALF_SIZE = 1.1;

export const RIM_DEPTH = 0.1;
export const RIM_BEVEL = 0.02;
export const RIM_FRONT = RIM_DEPTH / 2;

export const ENAMEL_RECESS = 0.028;
export const ENAMEL_DEPTH = 0.042;
export const ENAMEL_BEVEL = 0.008;
/** Enamel surface sits `ENAMEL_RECESS` below the metal, back buried in the plate. */
export const ENAMEL_Z = RIM_FRONT - ENAMEL_RECESS - ENAMEL_DEPTH / 2;

/** Raised metal details (rings, dividers, stars) share the rim's front plane. */
export const DETAIL_DEPTH = 0.07;
export const DETAIL_BEVEL = 0.014;
export const DETAIL_Z = RIM_FRONT - DETAIL_DEPTH / 2;

export const BACK_DEPTH = 0.03;
export const BACK_BEVEL = 0.008;
export const BACK_Z = -RIM_FRONT + 0.025;
/** The back plate is tucked inside the rim wall so no faces are coplanar. */
export const BACK_INSET = 0.025;

export type ExtrudeOptions = {
  depth: number;
  bevel: number;
  curveSegments?: number;
  bevelSegments?: number;
  creaseAngle?: number;
};

/**
 * Extrudes a shape, centres it on z = 0 and re-computes normals with a crease
 * angle so that curved walls stay smooth while bevel edges stay razor sharp —
 * that contrast is what makes the rims catch the light.
 */
export function extrudeCentered(
  shape: Shape | Shape[],
  { depth, bevel, curveSegments = 64, bevelSegments = 4, creaseAngle = Math.PI / 7 }: ExtrudeOptions,
): BufferGeometry {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    curveSegments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments,
  });
  geometry.translate(0, 0, -depth / 2);
  const creased = toCreasedNormals(geometry, creaseAngle);
  geometry.dispose();
  creased.computeBoundingSphere();
  return creased;
}

/** Circle, optionally with a concentric hole (a flat ring). */
export function circleShape(radius: number, hole = 0, cx = 0, cy = 0): Shape {
  const shape = new Shape();
  shape.absarc(cx, cy, radius, 0, Math.PI * 2, false);
  if (hole > 0) {
    const path = new Path();
    path.absarc(cx, cy, hole, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }
  return shape;
}

/** Punches an arbitrary shape into another as a hole (sampled to a path). */
export function withHole(shape: Shape, hole: Shape, divisions = 16): Shape {
  const path = new Path(hole.getPoints(divisions));
  path.autoClose = true;
  shape.holes.push(path);
  return shape;
}

/** Ellipse, optionally with a concentric elliptical hole. */
export function ellipseShape(rx: number, ry: number, holeRx = 0, holeRy = 0): Shape {
  const shape = new Shape();
  shape.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
  if (holeRx > 0 && holeRy > 0) {
    const path = new Path();
    path.absellipse(0, 0, holeRx, holeRy, 0, Math.PI * 2, true, 0);
    shape.holes.push(path);
  }
  return shape;
}

/** Polygon outline, optionally with a polygon hole (both as point lists). */
export function polygonShape(points: Vector2[], hole?: Vector2[]): Shape {
  const shape = new Shape(points);
  shape.autoClose = true;
  if (hole && hole.length > 2) {
    const path = new Path(hole);
    path.autoClose = true;
    shape.holes.push(path);
  }
  return shape;
}

/** Vertices of a regular polygon, first vertex at `rotation` radians. */
export function regularPolygonPoints(sides: number, radius: number, rotation = Math.PI / 2): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    points.push(new Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius));
  }
  return points;
}

/** Polygon with the corners softened by quadratic fillets. */
export function roundedPolygonShape(points: Vector2[], cornerRadius: number): Shape {
  const shape = new Shape();
  const count = points.length;

  for (let i = 0; i < count; i++) {
    const prev = points[(i - 1 + count) % count];
    const current = points[i];
    const next = points[(i + 1) % count];

    const toPrev = prev.clone().sub(current);
    const toNext = next.clone().sub(current);
    const inset = Math.min(cornerRadius, toPrev.length() * 0.5, toNext.length() * 0.5);

    const start = current.clone().add(toPrev.normalize().multiplyScalar(inset));
    const end = current.clone().add(toNext.normalize().multiplyScalar(inset));

    if (i === 0) shape.moveTo(start.x, start.y);
    else shape.lineTo(start.x, start.y);
    shape.quadraticCurveTo(current.x, current.y, end.x, end.y);
  }

  shape.closePath();
  return shape;
}

function signedArea(points: Vector2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Ensures counter-clockwise winding so "inward" is well defined. */
export function ensureCCW(points: Vector2[]): Vector2[] {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

function dedupe(points: Vector2[], epsilon = 1e-4): Vector2[] {
  const result: Vector2[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (!last || last.distanceTo(point) > epsilon) result.push(point);
  }
  if (result.length > 1 && result[0].distanceTo(result[result.length - 1]) <= epsilon) result.pop();
  return result;
}

/**
 * Inward offset of a polygon along vertex bisectors — used to derive an
 * even-width rim for arbitrary silhouettes (the shield). Sharp corners use a
 * miter limit so the offset never shoots off to infinity.
 */
export function offsetPolygon(points: Vector2[], distance: number, miterLimit = 2.5): Vector2[] {
  const source = ensureCCW(dedupe(points));
  const count = source.length;
  const result: Vector2[] = [];

  for (let i = 0; i < count; i++) {
    const prev = source[(i - 1 + count) % count];
    const current = source[i];
    const next = source[(i + 1) % count];

    // Inward normals (left-hand side of each edge for CCW winding).
    const e0 = current.clone().sub(prev).normalize();
    const e1 = next.clone().sub(current).normalize();
    const n0 = new Vector2(-e0.y, e0.x);
    const n1 = new Vector2(-e1.y, e1.x);

    const bisector = n0.clone().add(n1);
    if (bisector.lengthSq() < 1e-8) {
      result.push(current.clone().add(n0.multiplyScalar(distance)));
      continue;
    }
    bisector.normalize();

    const projection = Math.max(bisector.dot(n0), 1 / miterLimit);
    result.push(current.clone().add(bisector.multiplyScalar(distance / projection)));
  }

  return dedupe(result);
}

type HalfPlane = { axis: "y"; value: number; keep: "above" | "below" };

/**
 * Sutherland–Hodgman clip of a convex polygon against a horizontal half-plane.
 * Used to carve one silhouette into several enamel fields.
 */
export function clipPolygon(points: Vector2[], { value, keep }: Omit<HalfPlane, "axis">): Vector2[] {
  const inside = (p: Vector2) => (keep === "above" ? p.y >= value : p.y <= value);
  const result: Vector2[] = [];

  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const currentIn = inside(current);
    const nextIn = inside(next);

    if (currentIn) result.push(current.clone());
    if (currentIn !== nextIn) {
      const t = (value - current.y) / (next.y - current.y);
      result.push(new Vector2(current.x + (next.x - current.x) * t, value));
    }
  }

  return dedupe(result);
}

/** Convenience: the slice of a convex polygon between two heights. */
export function bandPolygon(points: Vector2[], bottom: number, top: number): Vector2[] {
  return clipPolygon(clipPolygon(points, { value: bottom, keep: "above" }), {
    value: top,
    keep: "below",
  });
}

/**
 * Heraldic shield silhouette: gently arched top edge, straight shoulders and
 * curved flanks meeting in a softly rounded point.
 */
export function shieldPoints(width: number, height: number, segments = 20): Vector2[] {
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  const shape = new Shape();
  shape.moveTo(-halfWidth, halfHeight * 0.86);
  // Arched top edge.
  shape.quadraticCurveTo(0, halfHeight * 1.06, halfWidth, halfHeight * 0.86);
  // Right shoulder, then the flank sweeping into the tip.
  shape.lineTo(halfWidth, -halfHeight * 0.18);
  shape.bezierCurveTo(
    halfWidth,
    -halfHeight * 0.62,
    halfWidth * 0.62,
    -halfHeight * 0.86,
    0,
    -halfHeight,
  );
  shape.bezierCurveTo(
    -halfWidth * 0.62,
    -halfHeight * 0.86,
    -halfWidth,
    -halfHeight * 0.62,
    -halfWidth,
    -halfHeight * 0.18,
  );
  shape.closePath();

  return ensureCCW(dedupe(shape.getPoints(segments)));
}

/** Classic n-pointed star used as the raised detail on the oval pin. */
export function starShape(pointCount: number, outerRadius: number, innerRadius: number): Shape {
  const shape = new Shape();
  const steps = pointCount * 2;

  for (let i = 0; i < steps; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = Math.PI / 2 + (i / steps) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }

  shape.closePath();
  return shape;
}
