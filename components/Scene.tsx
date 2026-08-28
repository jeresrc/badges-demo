"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { button, Leva, useControls } from "leva";
import { Color } from "three";
import type { Group } from "three";
import type { DissolveAppearanceUniforms } from "../lib/dissolve";
import { Badge, BADGE_PRESETS, BADGE_VARIANTS } from "./badges";
import type { BadgeVariant } from "./badges";
import type { PinMaterialSettings } from "./badges/materials";
import { DissolveInstance } from "./DissolveInstance";
import { Studio } from "./Studio";
import { useBadgeTransition } from "./useBadgeTransition";

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
  const { duration, stagger, noiseScale, edgeWidth, edgeColor, edgeIntensity } = useControls(
    "Transition",
    {
      duration: { value: 0.9, min: 0.2, max: 3, step: 0.05 },
      stagger: { value: 0.3, min: 0, max: 1.5, step: 0.05 },
      noiseScale: { value: 3, min: 0.5, max: 12, step: 0.1 },
      edgeWidth: { value: 0.06, min: 0.005, max: 0.25, step: 0.005 },
      edgeColor: "#ff9a3c",
      edgeIntensity: { value: 7, min: 0, max: 30, step: 0.5 },
      replay: button(() => replayRef.current()),
    },
  );

  const { bloomIntensity, bloomThreshold, autoRotateSpeed, spotIntensity } = useControls("Scene", {
    bloomIntensity: { value: 0.55, min: 0, max: 3, step: 0.05 },
    bloomThreshold: { value: 1.0, min: 0, max: 1.5, step: 0.01 },
    autoRotateSpeed: { value: 0.35, min: 0, max: 2, step: 0.01 },
    spotIntensity: { value: 28, min: 0, max: 300, step: 1 },
  });

  // Each pin ships with its own signature enamel colour; switching variants
  // re-seeds the picker instead of dragging the previous colour along.
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

  const { instances, onExited, replay } = useBadgeTransition(variant, materials, stagger);
  replayRef.current = replay;

  // The look uniforms are shared by reference with every patched material, so
  // leva edits are plain mutations — no material rebuilds, no re-compiles.
  const dissolveAppearance = useMemo<DissolveAppearanceUniforms>(
    () => ({
      uDissolveNoiseScale: { value: 3 },
      uDissolveEdgeWidth: { value: 0.06 },
      uDissolveEdgeColor: { value: new Color("#ff9a3c") },
    }),
    [],
  );
  dissolveAppearance.uDissolveNoiseScale.value = noiseScale;
  dissolveAppearance.uDissolveEdgeWidth.value = edgeWidth;
  // HDR edge: intensity pushes the colour past the bloom threshold (1.0).
  dissolveAppearance.uDissolveEdgeColor.value.set(edgeColor).multiplyScalar(edgeIntensity);

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
            {instances.map((instance) => (
              <DissolveInstance
                key={instance.id}
                instance={instance}
                appearance={dissolveAppearance}
                duration={duration}
                materials={materials}
                onExited={onExited}
              >
                <Badge variant={instance.variant} />
              </DissolveInstance>
            ))}
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
