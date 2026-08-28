"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, wrapEffect } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { button, Leva, useControls } from "leva";
import type { Group } from "three";
import { DreamBlurEffect } from "../lib/dreamBlur";
import { BADGE_PRESETS, BADGE_VARIANTS } from "./badges";
import type { BadgeVariant } from "./badges";
import type { PinMaterialSettings } from "./badges/materials";
import { BadgeTransition } from "./BadgeTransition";
import type { TransitionSettings } from "./BadgeTransition";
import { Studio } from "./Studio";

// Registered once at module scope so the component identity stays stable and
// the effect instance is never rebuilt behind the composer's back.
const DreamBlur = wrapEffect(DreamBlurEffect);

/**
 * Gentle idle sway — the badge never turns its back to the camera, it just
 * rocks a few degrees so the highlights keep sliding across the metal the way
 * a product shot on a slow gimbal would.
 */
function PinStage({ speed, children }: { speed: number; children: React.ReactNode }) {
  const group = useRef<Group>(null);

  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    group.current.rotation.y = Math.sin(t * 0.45 * speed) * 0.38;
    group.current.rotation.x = Math.sin(t * 0.3 * speed) * 0.07;
  });

  return <group ref={group}>{children}</group>;
}

export default function Scene() {
  const { variant } = useControls("Badge", {
    variant: { value: "medallion", options: [...BADGE_VARIANTS] },
  }) as { variant: BadgeVariant };

  const [
    {
      enamelColor,
      enamelRoughness,
      clearcoat,
      clearcoatRoughness,
      metalRoughness,
      metalness,
      envMapIntensity,
    },
    setMaterials,
  ] = useControls("Materials", () => ({
    enamelColor: BADGE_PRESETS.medallion.enamelColor,
    enamelRoughness: { value: 0.22, min: 0.02, max: 0.8, step: 0.01 },
    clearcoat: { value: 1, min: 0, max: 1, step: 0.01 },
    clearcoatRoughness: { value: 0.06, min: 0, max: 0.5, step: 0.005 },
    metalRoughness: { value: 0.12, min: 0.01, max: 0.8, step: 0.01 },
    metalness: { value: 1, min: 0, max: 1, step: 0.01 },
    envMapIntensity: { value: 1.15, min: 0, max: 4, step: 0.05 },
  }));

  const replayRef = useRef<() => void>(() => {});
  const {
    duration,
    particleCount,
    particleSize,
    cohesion,
    blobSize,
    turbulence,
    turbulenceScale,
    lift,
    wave,
    melt,
    glow,
    blur,
    blurRadius,
    halation,
    erodeScale,
    erodeSoftness,
  } = useControls("Transition", {
    duration: { value: 1.8, min: 0.4, max: 3.5, step: 0.05 },
    // Fewer and larger than a spray would need: overlapping sprites are what
    // fuse into a body. Upper bound is the cloud's pre-allocated MAX_PARTICLES.
    particleCount: { value: 2200, min: 400, max: 8000, step: 100 },
    particleSize: { value: 0.055, min: 0.008, max: 0.16, step: 0.002 },
    cohesion: { value: 0.72, min: 0, max: 1, step: 0.01 },
    blobSize: { value: 0.62, min: 0.15, max: 1.4, step: 0.01 },
    turbulence: { value: 0.12, min: 0, max: 0.6, step: 0.005 },
    turbulenceScale: { value: 0.9, min: 0.2, max: 4, step: 0.05 },
    lift: { value: 0.12, min: 0, max: 0.8, step: 0.01 },
    wave: { value: 0.35, min: 0, max: 0.85, step: 0.01 },
    melt: { value: 0.18, min: 0, max: 0.5, step: 0.01 },
    glow: { value: 1, min: 0, max: 4, step: 0.05 },
    blur: { value: 0.55, min: 0, max: 1, step: 0.01 },
    blurRadius: { value: 10, min: 2, max: 40, step: 0.5 },
    halation: { value: 0.18, min: 0, max: 1.5, step: 0.01 },
    erodeScale: { value: 1.6, min: 0.4, max: 8, step: 0.1 },
    erodeSoftness: { value: 0.28, min: 0.02, max: 0.6, step: 0.01 },
    replay: button(() => replayRef.current()),
  });

  const { bloomIntensity, bloomThreshold, autoRotateSpeed, spotIntensity } = useControls("Scene", {
    bloomIntensity: { value: 0.55, min: 0, max: 3, step: 0.05 },
    bloomThreshold: { value: 1.0, min: 0, max: 1.5, step: 0.01 },
    autoRotateSpeed: { value: 0.35, min: 0, max: 2, step: 0.01 },
    spotIntensity: { value: 28, min: 0, max: 300, step: 1 },
  });

  // Each pin ships with its own signature enamel colour; switching variants
  // re-seeds the picker instead of dragging the previous colour along. The
  // badge that is leaving keeps its old colour — the transition freezes a
  // snapshot of these settings for it.
  useEffect(() => {
    setMaterials({ enamelColor: BADGE_PRESETS[variant].enamelColor });
  }, [variant, setMaterials]);

  const materials = useMemo<PinMaterialSettings>(
    () => ({
      enamelColor,
      enamelRoughness,
      clearcoat,
      clearcoatRoughness,
      metalRoughness,
      metalness,
      envMapIntensity,
    }),
    [
      enamelColor,
      enamelRoughness,
      clearcoat,
      clearcoatRoughness,
      metalRoughness,
      metalness,
      envMapIntensity,
    ],
  );

  const transition = useMemo<TransitionSettings>(
    () => ({
      duration,
      particleCount,
      particleSize,
      cohesion,
      blobSize,
      turbulence,
      turbulenceScale,
      lift,
      wave,
      melt,
      glow,
      blur,
      blurRadius,
      halation,
      erodeScale,
      erodeSoftness,
    }),
    [
      duration,
      particleCount,
      particleSize,
      cohesion,
      blobSize,
      turbulence,
      turbulenceScale,
      lift,
      wave,
      melt,
      glow,
      blur,
      blurRadius,
      halation,
      erodeScale,
      erodeSoftness,
    ],
  );

  // The blur pass is driven per frame from inside the canvas (see
  // BadgeTransition), so it is handed over as a ref instead of as props.
  const dreamRef = useRef<DreamBlurEffect>(null);

  return (
    <main style={{ width: "100vw", height: "100vh", background: "#000" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [0, 0, 4.4], fov: 45, near: 0.1, far: 100 }}
      >
        <color attach="background" args={["#000000"]} />

        <Suspense fallback={null}>
          <Studio spotIntensity={spotIntensity} />
          <PinStage speed={autoRotateSpeed}>
            <BadgeTransition
              variant={variant}
              materials={materials}
              settings={transition}
              blur={dreamRef}
              replayRef={replayRef}
            />
          </PinStage>
        </Suspense>

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enablePan={false}
          minDistance={2.4}
          maxDistance={9}
        />

        <EffectComposer multisampling={8}>
          {/* First in the chain: the soft-focus haze it produces is what Bloom
              then blooms, which is most of the dreamlike quality. */}
          <DreamBlur ref={dreamRef} />
          <Bloom
            intensity={bloomIntensity}
            luminanceThreshold={bloomThreshold}
            luminanceSmoothing={0.25}
            mipmapBlur
            radius={0.75}
          />
          {/* EffectComposer turns the renderer's tone mapping off, so the curve
              has to be re-applied here or every highlight clips to flat white. */}
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        </EffectComposer>
      </Canvas>
      <Leva collapsed={false} />
    </main>
  );
}
