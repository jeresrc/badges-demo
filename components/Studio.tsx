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
 * shading and shadows across the recessed enamel.
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
        <Lightformer form="rect" intensity={14} scale={[2.6, 2.6, 1]} position={[-4, 3, 4]} color="#ffffff" />
        {/* Long overhead strip — the highlight that sweeps across the rim. */}
        <Lightformer form="rect" intensity={7} scale={[9, 0.6, 1]} position={[0, 4.5, 1.5]} color="#ffffff" />
        {/* Narrow cool strip catching the right edge. */}
        <Lightformer form="rect" intensity={4} scale={[0.7, 5, 1]} position={[5, 0, 2.5]} color="#bcd4ff" />
        {/* Small fill panel keeping the shadow side of the rim off pure black. */}
        <Lightformer form="rect" intensity={5} scale={[1.2, 3.5, 1]} position={[3.5, 1.5, 3.5]} color="#fff0dd" />
        {/* Narrow warm strip catching the left edge. */}
        <Lightformer form="rect" intensity={3} scale={[0.6, 4, 1]} position={[-5.5, -1, 1]} color="#ffd0a0" />
        {/* Big, dim fill card on the camera axis. Without it every surface that
            faces the lens — the star emblem, the flat enamel fields — reflects
            nothing but the black room and reads as a silhouette. */}
        <Lightformer form="rect" intensity={1.1} scale={[18, 18, 1]} position={[0, 1, 6]} color="#dbe6ff" />
        {/* Warm kicker behind the subject, seen in the rim's outer bevel. */}
        <Lightformer form="ring" intensity={4} scale={3} position={[3, 2, -5]} color="#ffcf9a" />
      </Environment>
    </>
  );
}
