"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { AdaptiveDpr, OrbitControls } from "@react-three/drei";
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

type DiagnosticSample = {
  frameIntervalMs: number;
  cpuSubmitMs: number;
  calls: number;
  triangles: number;
  pixelRatio: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function PerformanceDiagnostics({
  variant,
  clearcoat,
  adaptiveDpr,
}: {
  variant: BadgeVariant;
  clearcoat: number;
  adaptiveDpr: boolean;
}) {
  const gl = useThree((state) => state.gl);
  const frameStartedAt = useRef(0);
  const frameCount = useRef(0);
  const samples = useRef<DiagnosticSample[]>([]);
  const reported = useRef(false);
  const gpuTimerAvailable = useRef(false);

  useEffect(() => {
    const previousAutoReset = gl.info.autoReset;
    const context = gl.getContext();
    gpuTimerAvailable.current =
      context instanceof WebGL2RenderingContext &&
      context.getExtension("EXT_disjoint_timer_query_webgl2") !== null;
    gl.info.autoReset = false;
    gl.info.reset();

    return () => {
      gl.info.autoReset = previousAutoReset;
      gl.info.reset();
      frameCount.current = 0;
      samples.current = [];
      reported.current = false;
    };
  }, [gl]);

  useFrame(() => {
    gl.info.reset();
    frameStartedAt.current = performance.now();
  }, Number.NEGATIVE_INFINITY);

  useFrame((_, delta) => {
    frameCount.current += 1;
    if (frameCount.current <= 120 || reported.current) return;

    samples.current.push({
      frameIntervalMs: delta * 1000,
      cpuSubmitMs: performance.now() - frameStartedAt.current,
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      pixelRatio: gl.getPixelRatio(),
    });

    if (samples.current.length === 300) {
      const current = samples.current;
      reported.current = true;
      console.info("[3d-performance]", {
        variant,
        clearcoat,
        adaptiveDpr,
        contextAntialias: gl.getContext().getContextAttributes()?.antialias ?? null,
        gpuTiming: gpuTimerAvailable.current
          ? "not measured in app; use a verified browser GPU trace"
          : "unavailable: EXT_disjoint_timer_query_webgl2 is absent",
        frameIntervalMs: median(current.map((sample) => sample.frameIntervalMs)),
        cpuSubmitMs: median(current.map((sample) => sample.cpuSubmitMs)),
        calls: median(current.map((sample) => sample.calls)),
        triangles: median(current.map((sample) => sample.triangles)),
        pixelRatio: median(current.map((sample) => sample.pixelRatio)),
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
      });
    }
  }, Number.POSITIVE_INFINITY);

  return null;
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

  const { bloomIntensity, bloomThreshold, autoRotateSpeed, spotIntensity } = useControls("Scene", {
    bloomIntensity: { value: 0.55, min: 0, max: 3, step: 0.05 },
    bloomThreshold: { value: 1.0, min: 0, max: 1.5, step: 0.01 },
    autoRotateSpeed: { value: 0.35, min: 0, max: 2, step: 0.01 },
    spotIntensity: { value: 28, min: 0, max: 300, step: 1 },
  });

  const { adaptiveDpr, showDiagnostics } = useControls("Performance", {
    adaptiveDpr: false,
    showDiagnostics: false,
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
      // Three recompiles MeshPhysicalMaterial when clearcoat crosses zero.
      // Epsilon is visually zero while keeping the shader define stable.
      clearcoat: Math.max(clearcoat, Number.EPSILON),
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
        dpr={[1, 2]}
        gl={{ antialias: false }}
        performance={{ min: 0.5, max: 1, debounce: 200 }}
        camera={{ position: [0, 0, 4.4], fov: 45, near: 0.1, far: 100 }}
      >
        <color attach="background" args={["#000000"]} />

        <Suspense fallback={null}>
          <Studio spotIntensity={spotIntensity} />
          <PinMaterialProvider value={materials}>
            <PinStage speed={autoRotateSpeed}>
              <Badge variant={variant} />
            </PinStage>
          </PinMaterialProvider>
        </Suspense>

        {adaptiveDpr && <AdaptiveDpr />}

        <OrbitControls
          key={adaptiveDpr ? "adaptive-dpr" : "fixed-dpr"}
          makeDefault
          regress={adaptiveDpr}
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
        {showDiagnostics && (
          <PerformanceDiagnostics
            key={`${variant}:${clearcoat}:${adaptiveDpr}`}
            variant={variant}
            clearcoat={clearcoat}
            adaptiveDpr={adaptiveDpr}
          />
        )}
      </Canvas>
      <Leva collapsed={false} />
    </main>
  );
}
