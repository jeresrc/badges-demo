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
      <ambientLight intensity={0.05} />

      <spotLight
        position={[4.5, 5, 6.5]}
        angle={0.5}
        penumbra={0.9}
        intensity={spotIntensity}
        color="#fff3e4"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
      <spotLight
        position={[-5.5, -2.5, 4]}
        angle={0.6}
        penumbra={1}
        intensity={spotIntensity * 0.4}
        color="#8fb2ff"
      />

      <Environment resolution={256} frames={1}>
        {/* Key softbox, upper left. */}
        <Lightformer form="rect" intensity={6} scale={[7, 7, 1]} position={[-4.5, 3, 5]} color="#ffffff" />
        {/* Cool fill, lower right. */}
        <Lightformer form="rect" intensity={1.8} scale={[5, 8, 1]} position={[5, -1.5, 3.5]} color="#c2d8ff" />
        {/* Overhead strip — the long highlight that travels across the rim. */}
        <Lightformer form="rect" intensity={4} scale={[12, 1.4, 1]} position={[0, 6, 1]} color="#ffffff" />
        {/* Warm kicker behind the subject. */}
        <Lightformer form="ring" intensity={5} scale={4} position={[3.5, 2, -6]} color="#ffd6a5" />
        {/* Cool edge kicker on the opposite side. */}
        <Lightformer form="rect" intensity={2.5} scale={[1.6, 8, 1]} position={[-6, 0, -3]} color="#9dc0ff" />
      </Environment>
    </>
  );
}
