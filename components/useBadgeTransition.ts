"use client";

import { useCallback, useRef, useState } from "react";
import { Matrix4 } from "three";
import type { BadgeVariant } from "./badges";
import type { PinMaterialSettings } from "./badges/materials";
import type { ErodeInstanceUniforms } from "../lib/erode";

/**
 * Transition state machine.
 *
 * The whole crossing is one scalar: `t` runs 0 (fully `from`) → 1 (fully
 * `to`). Everything else — badge erosion, particle interpolation, blur
 * envelope — is a pure function of it, which is what makes interruptions
 * tractable.
 *
 * Two properties are relied on everywhere:
 *
 * 1. The erosion ramps are mirror images (`erodeOut(1 - t) === erodeIn(t)`),
 *    and the particle path is symmetric by construction. So *mirroring* a
 *    crossing — swap `from`/`to`, set `t = 1 - t`, swap the two ends of the
 *    particle buffers — is visually continuous at any `t`, with no copies.
 * 2. Below `t = 0.45` the incoming badge is still fully eroded, i.e. not on
 *    screen yet, so its identity can be swapped out for free.
 *
 * From those, rapid switching resolves to:
 *
 * - back to the badge that is leaving → mirror (it walks back in),
 * - to a third badge → mirror first if we are past halfway (so the badge the
 *   viewer can actually see becomes the one that leaves), then retarget the
 *   incoming slot, which is still invisible.
 *
 * `t` is never reset mid-flight, so no interruption can make a badge pop.
 */

export type BadgeSlot = {
  variant: BadgeVariant;
  uniforms: ErodeInstanceUniforms;
  /**
   * Melt contraction, written by the driver and applied to the badge's group.
   * A badge does not just fade out where it stands: it draws in towards its
   * own centre as it goes, which is what hands the silhouette over to the
   * mass instead of leaving a hole.
   */
  scale: number;
  /**
   * Material settings captured when this badge was told to leave: leva
   * re-seeds the enamel picker for the incoming variant, and the outgoing one
   * must keep the colour it was wearing. `null` = follow the live settings.
   */
  frozenMaterials: PinMaterialSettings | null;
};

export type TransitionMachine = {
  /** The badge that is leaving. `null` while idle. */
  from: BadgeVariant | null;
  /** The badge that is arriving, and the resting badge once idle. */
  to: BadgeVariant;
  /** 0 → 1 across the crossing. Stays at 1 while idle. */
  t: number;
  active: boolean;
  /** The driver must (re)sample the outgoing badge into the cloud. */
  needsFrom: boolean;
  /** The driver must (re)sample the incoming badge into the cloud. */
  needsTo: boolean;
  /** Pending mirror operations for the driver to apply to the cloud buffers. */
  flips: number;
};

function makeSlot(variant: BadgeVariant): BadgeSlot {
  return {
    variant,
    uniforms: {
      uErode: { value: 0 },
      uErodeRootInv: { value: new Matrix4() },
    },
    scale: 1,
    frozenMaterials: null,
  };
}

export function useBadgeTransition(initial: BadgeVariant) {
  const machineRef = useRef<TransitionMachine>({
    from: null,
    to: initial,
    t: 1,
    active: false,
    needsFrom: false,
    needsTo: false,
    flips: 0,
  });

  // Slots are keyed by variant and reused, so a badge that is mounted, sent
  // away and immediately asked back never re-creates its geometry.
  const poolRef = useRef(new Map<BadgeVariant, BadgeSlot>());
  const slotFor = useCallback((variant: BadgeVariant) => {
    const pool = poolRef.current;
    let slot = pool.get(variant);
    if (!slot) {
      slot = makeSlot(variant);
      pool.set(variant, slot);
    }
    return slot;
  }, []);

  const [slots, setSlots] = useState<BadgeSlot[]>(() => [slotFor(initial)]);

  /** Mounts exactly the badges the machine currently needs, nothing else. */
  const reconcile = useCallback(
    (materials: PinMaterialSettings) => {
      const m = machineRef.current;
      const next: BadgeSlot[] = [];

      if (m.active && m.from && m.from !== m.to) {
        const leaving = slotFor(m.from);
        leaving.frozenMaterials ??= materials;
        next.push(leaving);
      }

      const arriving = slotFor(m.to);
      arriving.frozenMaterials = null;
      next.push(arriving);

      setSlots((prev) =>
        prev.length === next.length && prev.every((slot, i) => slot === next[i]) ? prev : next,
      );
    },
    [slotFor],
  );

  const mirror = useCallback(() => {
    const m = machineRef.current;
    const from = m.from;
    m.from = m.to;
    m.to = from ?? m.to;
    m.t = 1 - m.t;
    m.flips++;
  }, []);

  /** Ask for a variant. Safe to call at any point of any crossing. */
  const request = useCallback(
    (variant: BadgeVariant, materials: PinMaterialSettings) => {
      const m = machineRef.current;

      if (!m.active) {
        if (m.to === variant) return;
        m.from = m.to;
        m.to = variant;
        m.t = 0;
        m.active = true;
        m.needsFrom = true;
        m.needsTo = true;
      } else if (m.to === variant) {
        return;
      } else if (m.from === variant) {
        // Walk the leaving badge back in.
        mirror();
      } else {
        // Past halfway the arriving badge is the one on screen, so mirror
        // before retargeting or the wrong badge would be the one dissolving.
        if (m.t >= 0.5) mirror();
        m.to = variant;
        m.needsTo = true;
      }

      reconcile(materials);
    },
    [mirror, reconcile],
  );

  /** Dissolve the current badge into embers and let it condense back. */
  const crossSelf = useCallback(
    (materials: PinMaterialSettings) => {
      const m = machineRef.current;
      if (m.active) return;
      m.from = m.to;
      m.t = 0;
      m.active = true;
      m.needsFrom = true;
      m.needsTo = true;
      reconcile(materials);
    },
    [reconcile],
  );

  /** Called by the driver once `t` reaches 1: drop the badge that left. */
  const settle = useCallback(
    (materials: PinMaterialSettings) => {
      const m = machineRef.current;
      if (!m.active) return;
      m.active = false;
      m.from = null;
      m.t = 1;
      reconcile(materials);
    },
    [reconcile],
  );

  return { slots, machine: machineRef, request, crossSelf, settle };
}
