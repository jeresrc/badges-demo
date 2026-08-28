"use client";

import { useMemo } from "react";
import { PlaneGeometry } from "three";
import { FilmMaterial, MetalMaterial, PaperMaterial, usePinMaterials } from "./materials";
import { BackPlate, DetailPiece, EnamelPiece, RimPiece } from "./parts";
import { BACK_INSET, circleShape, starShape } from "./shapes";

const BAG_WIDTH = 1.72;
const BAG_HEIGHT = 2.3;
/** Vertical centre of the vacuum-formed pouch (the charm sits here). */
const POUCH_Y = -0.28;

const CARD_WIDTH = 1.78;
const CARD_HEIGHT = 0.52;
const CARD_Y = BAG_HEIGHT / 2 - CARD_HEIGHT / 2 + 0.1;

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The blister film: a plane displaced into a puffed pouch over the charm, with
 * a quilted dimple pattern and a few crossing crinkle waves. The displacement
 * fades to zero at the border so the edge reads as a heat-sealed flat seam.
 */
function useBagGeometry(mirror = false) {
  return useMemo(() => {
    const geometry = new PlaneGeometry(BAG_WIDTH, BAG_HEIGHT, 140, 180);
    const position = geometry.attributes.position;

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);

      // Flat sealed seam around the border.
      const fadeX = smoothstep(0, 0.16, BAG_WIDTH / 2 - Math.abs(x));
      const fadeY = smoothstep(0, 0.14, BAG_HEIGHT / 2 - Math.abs(y));
      const fade = fadeX * fadeY;

      // Vacuum-formed dome over the charm.
      const dx = x / 0.62;
      const dy = (y - POUCH_Y) / 0.72;
      const bulge = Math.exp(-(dx * dx + dy * dy)) * (mirror ? 0.1 : 0.34);

      // Quilted dimples + soft crinkle waves — the specular texture.
      const quilt = 0.007 * Math.sin(x * 17) * Math.sin(y * 17);
      const crinkle =
        0.008 * Math.sin(x * 9.7 + y * 5.3) +
        0.005 * Math.sin(x * 16.1 - y * 12.9 + 1.7) +
        0.0025 * Math.sin(x * 29 + y * 23 + 4.2);

      position.setZ(i, (bulge + quilt + crinkle) * fade);
    }

    geometry.computeVertexNormals();
    return geometry;
  }, [mirror]);
}

/** Small soft charm sealed inside the bag — a simple enamel roundel. */
function Charm() {
  const { enamelColor } = usePinMaterials();

  const rim = useMemo(() => circleShape(1, 0.86), []);
  const field = useMemo(() => circleShape(0.87), []);
  const back = useMemo(() => circleShape(1 - BACK_INSET), []);
  const star = useMemo(() => starShape(5, 0.5, 0.22), []);

  return (
    <group scale={0.52} position={[0, POUCH_Y, 0.02]}>
      <BackPlate shape={back} metal="gold" />
      <RimPiece shape={rim} metal="gold" />
      <EnamelPiece shape={field} color={enamelColor} />
      <DetailPiece shape={star} metal="gold" curveSegments={2} />
      {/* Keyring loop poking up from the charm. */}
      <mesh position={[0, 1.12, 0]} rotation={[0.35, 0, 0]} castShadow>
        <torusGeometry args={[0.22, 0.035, 24, 64]} />
        <MetalMaterial metal="silver" />
      </mesh>
      <mesh position={[0, 0.98, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.14, 24]} />
        <MetalMaterial metal="silver" />
      </mesh>
    </group>
  );
}

/**
 * Retail blister package: a charm sealed between two crinkled transmission
 * films with a folded matte header card on top and a small sticker inside.
 * The film is the star — glossy, crinkled, catching the studio panels.
 */
export function Packaged() {
  const frontFilm = useBagGeometry(false);
  const backFilm = useBagGeometry(true);

  return (
    <group position={[0, 0.08, 0]}>
      <Charm />

      {/* Small rectangular sticker sealed in with the charm. */}
      <mesh position={[0.02, POUCH_Y - 0.72, 0.03]} rotation={[0, 0, -0.06]}>
        <boxGeometry args={[0.42, 0.24, 0.012]} />
        <meshStandardMaterial color="#f2600e" roughness={0.55} />
      </mesh>

      {/* Front and back films of the blister bag. */}
      <mesh geometry={frontFilm} position={[0, 0, 0.09]}>
        <FilmMaterial />
      </mesh>
      <mesh geometry={backFilm} position={[0, 0, -0.09]} rotation={[0, Math.PI, 0]}>
        <FilmMaterial />
      </mesh>

      {/* Folded paper header card stapled over the sealed top edge. */}
      <group position={[0, CARD_Y, 0]}>
        <mesh position={[0, 0, 0.11]} castShadow>
          <boxGeometry args={[CARD_WIDTH, CARD_HEIGHT, 0.022]} />
          <PaperMaterial color="#c5cfba" />
        </mesh>
        <mesh position={[0, 0, -0.11]} castShadow>
          <boxGeometry args={[CARD_WIDTH, CARD_HEIGHT, 0.022]} />
          <PaperMaterial color="#c5cfba" />
        </mesh>
        <mesh position={[0, CARD_HEIGHT / 2, 0]} castShadow>
          <boxGeometry args={[CARD_WIDTH, 0.022, 0.242]} />
          <PaperMaterial color="#c5cfba" />
        </mesh>
        {/* Euro-slot hang hole punched through both flaps. */}
        <mesh position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 0.3, 24]} />
          <meshStandardMaterial color="#050505" roughness={1} />
        </mesh>
      </group>
    </group>
  );
}
