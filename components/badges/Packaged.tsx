"use client";

import { useEffect, useMemo } from "react";
import { PlaneGeometry } from "three";
import { FilmMaterial, MetalMaterial, PaperMaterial, usePinMaterials } from "./materials";
import { BackPlate, DetailPiece, EnamelPiece, RimPiece } from "./parts";
import {
  BACK_INSET,
  circleShape,
  extrudeCentered,
  roundedRectShape,
  stadiumShape,
  starShape,
  withHole,
} from "./shapes";

/* ------------------------------------------------------------------------ */
/* Package dimensions                                                        */

const BAG_WIDTH = 1.72;
const BAG_HEIGHT = 2.3;
/** Width of the flat heat-sealed weld running around the film border. */
const SEAL_WIDTH = 0.14;
/** Base plane of each film sheet; the charm is sandwiched between them. */
const FILM_Z = 0.065;

/** Vertical centre of the vacuum-formed pouch (the charm sits here). */
const POUCH_Y = -0.28;
const POUCH_RADIUS_X = 0.62;
const POUCH_RADIUS_Y = 0.68;
/** How far the pouch domes toward the camera (front) / away from it (back). */
const POUCH_HEIGHT_FRONT = 0.17;
const POUCH_HEIGHT_BACK = 0.06;

const CHARM_SCALE = 0.46;

/* ------------------------------------------------------------------------ */
/* Film texture — a few intentional folds, subtle quilting, faint micro-sheen */

type Fold = { from: [number, number]; to: [number, number]; amp: number; width: number };

/**
 * Sparse fold ridges radiating from the pouch shoulders. Each is a long
 * gaussian ridge between two points — they catch the studio strips as single
 * elegant specular streaks instead of noise.
 */
const FOLDS: Fold[] = [
  { from: [0.42, 0.28], to: [0.72, 0.9], amp: 0.004, width: 0.16 },
  { from: [-0.2, -0.94], to: [0.56, -1.02], amp: 0.006, width: 0.12 },
];

/** Quilted dimple zone — kept subtle so it reads as texture, not noise. */
const QUILT_AMPLITUDE = 0.0012;
const QUILT_FREQUENCY = 10;
/** Barely-there ripple that keeps big flat areas from reading dead. */
const MICRO_AMPLITUDE = 0.0004;

/** Puckered lip where the loose film meets the weld — draws the silhouette. */
const LIP_AMPLITUDE = 0.008;
const LIP_WIDTH = 0.05;

/* ------------------------------------------------------------------------ */
/* Header card                                                               */

const CARD_WIDTH = 1.8;
const CARD_HEIGHT = 0.56;
const CARD_THICKNESS = 0.022;
/** z distance between the two flap centre planes (clears film + lip). */
const CARD_GAP = 0.2;
/** y of the fold line — the card hangs down from here over the top seal. */
const CARD_FOLD_Y = BAG_HEIGHT / 2 + 0.07;
const CARD_COLOR = "#c9d2bb";
const SLOT_WIDTH = 0.34;
const SLOT_HEIGHT = 0.11;
/** Euro-slot centre, measured down from the fold. */
const SLOT_DROP = 0.2;

/* ------------------------------------------------------------------------ */

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Height contribution of one fold ridge at (x, y): gaussian across the
 *  segment, sine-tapered along it so both ends melt back into the film. */
function foldHeight(x: number, y: number, fold: Fold) {
  const [x0, y0] = fold.from;
  const [x1, y1] = fold.to;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy);
  const clamped = Math.min(1, Math.max(0, t));
  const px = x0 + dx * clamped;
  const py = y0 + dy * clamped;
  const distance = Math.hypot(x - px, y - py);
  const across = Math.exp(-(distance * distance) / (fold.width * fold.width));
  const along = Math.sin(clamped * Math.PI);
  return fold.amp * across * along;
}

/**
 * One film sheet: a plane displaced into a flat heat-sealed border, a
 * vacuum-formed dome hugging the charm (plateau profile, `exp(-r⁴)`), a few
 * deliberate fold ridges and a faint quilt/micro texture. All amplitudes are
 * the constants above so a future unwrap interaction can animate them.
 */
function useFilmGeometry(side: "front" | "back") {
  const geometry = useMemo(() => {
    const geometry = new PlaneGeometry(BAG_WIDTH, BAG_HEIGHT, 160, 200);
    const position = geometry.attributes.position;
    const pouchHeight = side === "front" ? POUCH_HEIGHT_FRONT : POUCH_HEIGHT_BACK;

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);

      // 0 on the welded border, 1 inside the loose film.
      const border = Math.min(BAG_WIDTH / 2 - Math.abs(x), BAG_HEIGHT / 2 - Math.abs(y));
      const loose = smoothstep(SEAL_WIDTH * 0.55, SEAL_WIDTH * 1.4, border);

      // Vacuum-formed dome with a flat plateau hugging the charm.
      const nx = x / POUCH_RADIUS_X;
      const ny = (y - POUCH_Y) / POUCH_RADIUS_Y;
      const r2 = nx * nx + ny * ny;
      const pouch = Math.exp(-r2 * r2) * pouchHeight;
      const pouchMask = Math.exp(-r2);

      let folds = 0;
      for (const fold of FOLDS) folds += foldHeight(x, y, fold);

      // Quilting fades out over the pouch; micro-sheen everywhere.
      const quilt =
        QUILT_AMPLITUDE *
        Math.sin(x * QUILT_FREQUENCY) *
        Math.sin(y * QUILT_FREQUENCY) *
        (1 - pouchMask);
      const micro = MICRO_AMPLITUDE * Math.sin(x * 41 + y * 27);

      // Pucker line just inside the weld — a thin highlight tracing the edge.
      const lipDistance = border - SEAL_WIDTH;
      const lip = LIP_AMPLITUDE * Math.exp(-(lipDistance * lipDistance) / (LIP_WIDTH * LIP_WIDTH));

      position.setZ(i, (pouch + folds + quilt + micro) * loose + lip);
    }

    geometry.computeVertexNormals();
    return geometry;
  }, [side]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return geometry;
}

/** Small enamel charm with a silver keyring loop, sealed inside the pouch. */
function Charm() {
  const { enamelColor } = usePinMaterials();

  const rim = useMemo(() => circleShape(1, 0.86), []);
  const field = useMemo(() => circleShape(0.87), []);
  const back = useMemo(() => circleShape(1 - BACK_INSET), []);
  const star = useMemo(() => starShape(5, 0.5, 0.22), []);

  return (
    <group name="charm" scale={CHARM_SCALE} position={[0, POUCH_Y, 0]}>
      <BackPlate shape={back} metal="gold" />
      <RimPiece shape={rim} metal="gold" />
      <EnamelPiece shape={field} color={enamelColor} />
      <DetailPiece shape={star} metal="gold" curveSegments={2} />
      <mesh name="charm-loop" position={[0, 1.16, 0]}>
        <torusGeometry args={[0.2, 0.038, 24, 64]} />
        <MetalMaterial metal="silver" />
      </mesh>
      <mesh name="charm-loop-post" position={[0, 0.99, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.16, 24]} />
        <MetalMaterial metal="silver" />
      </mesh>
    </group>
  );
}

/**
 * Folded matte header card. The group's origin sits ON the fold line so a
 * future opening interaction can rotate either flap around x to peel it up.
 */
function HeaderCard() {
  const flapGeometry = useMemo(() => {
    const outline = roundedRectShape(CARD_WIDTH, CARD_HEIGHT, 0.05);
    const slot = stadiumShape(SLOT_WIDTH, SLOT_HEIGHT, 0, CARD_HEIGHT / 2 - SLOT_DROP);
    return extrudeCentered(withHole(outline, slot, 32), {
      depth: CARD_THICKNESS,
      bevel: 0.004,
      curveSegments: 12,
      // Keep the big flat faces perfectly flat — merging them with the bevel
      // ring smears diagonal shading gradients across the card.
      creaseAngle: 0.5,
    });
  }, []);

  useEffect(() => () => flapGeometry.dispose(), [flapGeometry]);

  // Slightly proud of the flap faces so the crease reads as folded paper.
  const foldRadius = CARD_GAP / 2 + CARD_THICKNESS / 2 + 0.004;

  return (
    <group name="header-card" position={[0, CARD_FOLD_Y, 0]}>
      <group name="header-card-front" position={[0, 0, CARD_GAP / 2]}>
        <mesh geometry={flapGeometry} position={[0, -CARD_HEIGHT / 2, 0]}>
          <PaperMaterial color={CARD_COLOR} />
        </mesh>
      </group>
      <group name="header-card-back" position={[0, 0, -CARD_GAP / 2]}>
        <mesh geometry={flapGeometry} position={[0, -CARD_HEIGHT / 2, 0]}>
          <PaperMaterial color={CARD_COLOR} />
        </mesh>
      </group>
      <mesh name="header-card-fold" rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[foldRadius, CARD_WIDTH - 0.26, 8, 48]} />
        <PaperMaterial color={CARD_COLOR} />
      </mesh>
    </group>
  );
}

/**
 * Retail blister package. Every part a future unwrap interaction needs is a
 * separately named group with a sensible pivot:
 *
 *   package
 *   ├─ charm ............ enamel charm + keyring loop, pivot at charm centre
 *   ├─ sticker .......... small orange sticker, loose between the films
 *   ├─ film-front ....... front film sheet, base plane at z = +FILM_Z
 *   ├─ film-back ........ back film sheet, base plane at z = −FILM_Z
 *   └─ header-card ...... folded paper card, pivot on the fold line
 *      ├─ header-card-front / header-card-back (flaps, hang from the fold)
 *      └─ header-card-fold (crease cylinder)
 */
export function Packaged() {
  const frontFilm = useFilmGeometry("front");
  const backFilm = useFilmGeometry("back");

  const stickerGeometry = useMemo(
    () =>
      extrudeCentered(roundedRectShape(0.42, 0.24, 0.05), {
        depth: 0.012,
        bevel: 0.003,
        curveSegments: 12,
      }),
    [],
  );

  useEffect(() => () => stickerGeometry.dispose(), [stickerGeometry]);

  return (
    <group name="package" position={[0, -0.04, 0]}>
      <Charm />

      <mesh
        name="sticker"
        geometry={stickerGeometry}
        position={[0.05, -0.9, -0.03]}
        rotation={[0, 0, -0.08]}
      >
        <meshStandardMaterial color="#f2600e" roughness={0.5} />
      </mesh>

      <group name="film-front" position={[0, 0, FILM_Z]}>
        <mesh geometry={frontFilm}>
          <FilmMaterial />
        </mesh>
      </group>
      <group name="film-back" position={[0, 0, -FILM_Z]} rotation={[0, Math.PI, 0]}>
        <mesh geometry={backFilm}>
          <FilmMaterial />
        </mesh>
      </group>

      <HeaderCard />
    </group>
  );
}
