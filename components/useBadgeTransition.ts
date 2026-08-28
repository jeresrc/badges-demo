"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Matrix4 } from "three";
import type { BadgeVariant } from "./badges";
import type { PinMaterialSettings } from "./badges/materials";
import type { DissolveInstanceUniforms } from "../lib/dissolve";

/**
 * One mounted badge participating in the transition. The object is stored in
 * React state for mount/unmount, but the animation fields (`raw`, `delay`,
 * `target`) are mutated in place from `useFrame` — re-rendering React 60 times
 * a second for a uniform would defeat the point.
 */
export type BadgeInstance = {
  id: number;
  variant: BadgeVariant;
  uniforms: DissolveInstanceUniforms;
  /** Linear animation parameter, 0 = fully present, 1 = fully dissolved. */
  raw: number;
  /** Where `raw` is heading: 0 materialize, 1 dissolve away. */
  target: 0 | 1;
  /** Seconds to hold before the materialize leg starts (stagger). */
  delay: number;
  /** Prevents onExited from firing every frame once the exit completes. */
  exitNotified: boolean;
  /**
   * Material settings frozen at the moment the badge was told to leave, so the
   * outgoing badge keeps its own enamel colour while leva re-seeds the picker
   * for the incoming one. `null` = follow the live leva settings.
   */
  frozenMaterials: PinMaterialSettings | null;
};

let nextId = 1;

function makeInstance(variant: BadgeVariant, raw: number, target: 0 | 1, delay: number): BadgeInstance {
  return {
    id: nextId++,
    variant,
    uniforms: {
      uDissolveProgress: { value: raw },
      uDissolveRootInv: { value: new Matrix4() },
    },
    raw,
    target,
    delay,
    exitNotified: false,
    frozenMaterials: null,
  };
}

/**
 * Dissolve-transition state machine.
 *
 * On a variant change every mounted badge is retargeted to "out" and the new
 * variant is mounted at "fully dissolved", heading "in" after a stagger delay.
 * Rapid switching just retargets: if the requested variant is still mid-exit
 * it is simply told to come back, no duplicate mount, no timer juggling.
 *
 * `onExited` implements a small trick: when a badge finishes dissolving but is
 * *still the active variant* (i.e. the user hit replay), it bounces back in
 * instead of unmounting — which is exactly the replay choreography for free.
 */
export function useBadgeTransition(
  variant: BadgeVariant,
  materials: PinMaterialSettings,
  stagger: number,
) {
  const [instances, setInstances] = useState<BadgeInstance[]>(() => [
    makeInstance(variant, 0, 0, 0),
  ]);

  // Refs so onExited/replay stay referentially stable for leva buttons.
  const variantRef = useRef(variant);
  variantRef.current = variant;
  const materialsRef = useRef(materials);
  materialsRef.current = materials;
  const staggerRef = useRef(stagger);
  staggerRef.current = stagger;

  useEffect(() => {
    setInstances((prev) => {
      const existing = prev.find((inst) => inst.variant === variant);
      const next = prev.map((inst) => {
        if (inst.variant === variant) {
          // Coming back (rapid switch): retarget in place.
          inst.target = 0;
          inst.exitNotified = false;
          inst.frozenMaterials = null;
          inst.delay = 0;
          return inst;
        }
        // Everyone else leaves, keeping the look they had when dismissed.
        inst.target = 1;
        inst.delay = 0;
        inst.frozenMaterials ??= materialsRef.current;
        return inst;
      });
      if (existing) return [...next];
      return [...next, makeInstance(variant, 1, 0, staggerRef.current)];
    });
  }, [variant]);

  const onExited = useCallback((id: number) => {
    setInstances((prev) => {
      const inst = prev.find((i) => i.id === id);
      if (!inst) return prev;
      if (inst.variant === variantRef.current) {
        // Replay bounce: still the active variant, so materialize again.
        inst.target = 0;
        inst.exitNotified = false;
        inst.frozenMaterials = null;
        inst.delay = staggerRef.current;
        return [...prev];
      }
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  /** Dissolve everything out; the active variant bounces back in via onExited. */
  const replay = useCallback(() => {
    setInstances((prev) =>
      prev.map((inst) => {
        inst.target = 1;
        inst.exitNotified = false;
        return inst;
      }),
    );
  }, []);

  return { instances, onExited, replay };
}
