"use client";

import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Material, Mesh } from "three";
import { applyDissolve } from "../lib/dissolve";
import type { DissolveAppearanceUniforms } from "../lib/dissolve";
import { PinMaterialProvider } from "./badges/materials";
import type { PinMaterialSettings } from "./badges/materials";
import type { BadgeInstance } from "./useBadgeTransition";

/** Smoothstep easing on the linear parameter; symmetric, so retargets stay smooth. */
function ease(t: number) {
  return t * t * (3 - 2 * t);
}

/**
 * Mounts one badge and drives its dissolve. Every material found in the
 * subtree is patched once with the shared uniform objects; from then on the
 * whole badge is animated by writing a single number per frame.
 */
export function DissolveInstance({
  instance,
  appearance,
  duration,
  materials,
  onExited,
  children,
}: {
  instance: BadgeInstance;
  appearance: DissolveAppearanceUniforms;
  duration: number;
  /** Live leva material settings; overridden by the instance's frozen snapshot. */
  materials: PinMaterialSettings;
  onExited: (id: number) => void;
  children: React.ReactNode;
}) {
  const group = useRef<Group>(null);

  const uniforms = useMemo(
    () => ({ ...instance.uniforms, ...appearance }),
    [instance.uniforms, appearance],
  );

  const patchTree = useMemo(
    () => (root: Group) => {
      root.traverse((obj) => {
        const mesh = obj as Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats as Material[]) {
          if (mat.userData.dissolvePatched) continue;
          mat.userData.dissolvePatched = true;
          applyDissolve(mat, uniforms);
        }
      });
    },
    [uniforms],
  );

  // Patch synchronously on mount…
  useLayoutEffect(() => {
    if (group.current) patchTree(group.current);
  }, [patchTree]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;

    // …and re-sweep each frame so meshes that appear late (Text3D resolving
    // its font through Suspense) get patched before they are ever drawn.
    patchTree(g);

    // Noise is sampled in badge space: world position pulled back through the
    // inverse root matrix, so the pattern rides along with the stage sway.
    g.updateWorldMatrix(true, false);
    instance.uniforms.uDissolveRootInv.value.copy(g.matrixWorld).invert();

    if (instance.delay > 0) {
      instance.delay = Math.max(0, instance.delay - delta);
    } else {
      const step = delta / Math.max(duration, 0.001);
      instance.raw =
        instance.target === 1
          ? Math.min(1, instance.raw + step)
          : Math.max(0, instance.raw - step);
    }
    instance.uniforms.uDissolveProgress.value = ease(instance.raw);

    if (instance.target === 1 && instance.raw >= 1 && !instance.exitNotified) {
      instance.exitNotified = true;
      onExited(instance.id);
    }
  });

  return (
    <group ref={group}>
      <Suspense fallback={null}>
        <PinMaterialProvider value={instance.frozenMaterials ?? materials}>
          {children}
        </PinMaterialProvider>
      </Suspense>
    </group>
  );
}
