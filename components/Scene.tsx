"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Leva, useControls } from "leva";
import type { Group } from "three";
import { Badge, BADGE_PRESETS, BADGE_VARIANTS } from "./badges";
import type { BadgeVariant } from "./badges";
import { PinMaterialProvider } from "./badges/materials";
import type { PinMaterialSettings } from "./badges/materials";
import { Studio } from "./Studio";

/** Slow idle turntable plus a barely-there tilt so highlights keep moving. */
function PinStage({ speed, children }: { speed: number; children: React.ReactNode }) {
  const group = useRef<Group>(null);

  useFrame((state, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * speed;
    group.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.4) * 0.08;
  });

  return <group ref={group}>{children}</group>;
}

function DebugBridge() {
  const three = useThree();
  useEffect(() => {
    (window as unknown as { __three: unknown }).__three = three;
  }, [three]);
  return null;
}

export default function Scene() {
  const { variant } = useControls("Badge", {
    variant: { value: "circle", options: [...BADGE_VARIANTS] },
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
    enamelColor: BADGE_PRESETS.circle.enamelColor,
    enamelRoughness: { value: 0.22, min: 0.02, max: 0.8, step: 0.01 },
    clearcoat: { value: 1, min: 0, max: 1, step: 0.01 },
    clearcoatRoughness: { value: 0.06, min: 0, max: 0.5, step: 0.005 },
    metalRoughness: { value: 0.12, min: 0.01, max: 0.8, step: 0.01 },
    metalness: { value: 1, min: 0, max: 1, step: 0.01 },
    envMapIntensity: { value: 1.8, min: 0, max: 4, step: 0.05 },
  }));

  const { bloomIntensity, bloomThreshold, autoRotateSpeed, spotIntensity } = useControls("Scene", {
    bloomIntensity: { value: 0.7, min: 0, max: 3, step: 0.05 },
    bloomThreshold: { value: 0.72, min: 0, max: 1.5, step: 0.01 },
    autoRotateSpeed: { value: 0.35, min: 0, max: 2, step: 0.01 },
    spotIntensity: { value: 45, min: 0, max: 300, step: 1 },
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

  return (
    <main style={{ width: "100vw", height: "100vh", background: "#000" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [0, 0, 4.4], fov: 45, near: 0.1, far: 100 }}
      >
        <color attach="background" args={["#000000"]} />

        <DebugBridge />
        <Suspense fallback={null}>
          <Studio spotIntensity={spotIntensity} />
          <PinMaterialProvider value={materials}>
            <PinStage speed={autoRotateSpeed}>
              <Badge variant={variant} />
            </PinStage>
          </PinMaterialProvider>
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
