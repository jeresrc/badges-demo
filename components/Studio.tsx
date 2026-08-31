"use client";

import { Environment, Lightformer } from "@react-three/drei";

/**
 * Product-photography lighting rig.
 *
 * The reflections that sell polished metal come from the environment, not from
 * point lights, so the rig is a set of emissive Lightformer panels baked into a
 * small cube map: a big key softbox, a cool fill, an overhead strip and two
 * kickers behind the subject that draw bright edges along the rims. The map is
 * never used as a background, so the page stays pure black — you only ever see
 * the panels as reflections in the metal and in the enamel's clearcoat.
 *
 * Two real spot lights sit on top of that to give directional, controllable
 * shading across the recessed enamel without allocating shadow maps.
 */
export function Studio({ spotIntensity }: { spotIntensity: number }) {
  return (
    <>
      <ambientLight intensity={0.03} />

      <spotLight
        position={[4.5, 5, 6.5]}
        angle={0.5}
        penumbra={0.9}
        intensity={spotIntensity}
        color="#fff3e4"
      />
      <spotLight
        position={[-5.5, -2.5, 4]}
        angle={0.6}
        penumbra={1}
        intensity={spotIntensity * 0.35}
        color="#8fb2ff"
      />

      {/* Panels are deliberately narrow with wide black gaps between them: the
          gaps are what give polished metal its dark-to-mirror contrast. */}
      <Environment resolution={512} frames={1}>
        {/* Key softbox, upper left. */}
        <Lightformer form="rect" intensity={14} scale={[2.8, 2.8, 1]} position={[-4, 3, 4]} color="#ffffff" />
        {/* Long overhead strip — the highlight that sweeps across the rim. */}
        <Lightformer form="rect" intensity={8} scale={[9, 0.7, 1]} position={[0, 4.5, 1.5]} color="#ffffff" />
        {/* Narrow cool strip catching the right edge. */}
        <Lightformer form="rect" intensity={4.5} scale={[0.8, 5, 1]} position={[5, 0, 2.5]} color="#bcd4ff" />
        {/* Fill panel keeping the shadow side of the rim off pure black. */}
        <Lightformer form="rect" intensity={5} scale={[1.2, 3.5, 1]} position={[3.5, 1.5, 3.5]} color="#fff0dd" />
        {/* Narrow warm strip catching the left edge. */}
        <Lightformer form="rect" intensity={3.5} scale={[0.7, 4, 1]} position={[-5.5, -1, 1]} color="#ffd0a0" />
        {/* Big frontal fill card on the camera axis. Without it every surface
            that faces the lens — flat star emblems, camera-facing metal —
            reflects only the black room and reads as a silhouette. Dim and
            huge: it lifts frontal metal without flattening the contrast. */}
        <Lightformer form="rect" intensity={0.45} scale={[16, 16, 1]} position={[0, 0.5, 7]} color="#e8eeff" />
        {/* Tight frontal card — the "camera softbox" reflection that actually
            reads as a highlight in camera-facing gold and chrome. */}
        <Lightformer form="rect" intensity={5} scale={[2.2, 1.3, 1]} position={[0.8, 2, 5.5]} color="#fff6e8" />
        {/* Warm kicker behind the subject, seen in the rim's outer bevel. */}
        <Lightformer form="ring" intensity={4} scale={3} position={[3, 2, -5]} color="#ffcf9a" />
      </Environment>
    </>
  );
}
