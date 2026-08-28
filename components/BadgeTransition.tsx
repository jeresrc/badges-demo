"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, Vector2 } from "three";
import type { Group, Material, Mesh } from "three";
import { EMBER, fillFallbackCloud, sampleBadgeSurface } from "../lib/badgeSurface";
import type { BadgeSample } from "../lib/badgeSurface";
import type { DreamBlurEffect } from "../lib/dreamBlur";
import { applyErode } from "../lib/erode";
import type { ErodeLookUniforms } from "../lib/erode";
import { ParticleCloud } from "../lib/particleCloud";
import { Badge } from "./badges";
import type { BadgeVariant } from "./badges";
import { PinMaterialProvider } from "./badges/materials";
import type { PinMaterialSettings } from "./badges/materials";
import { useBadgeTransition } from "./useBadgeTransition";
import type { BadgeSlot, TransitionMachine } from "./useBadgeTransition";

export type TransitionSettings = {
  duration: number;
  particleCount: number;
  drift: number;
  turbulence: number;
  lift: number;
  stagger: number;
  particleSize: number;
  blur: number;
  blurRadius: number;
  halation: number;
  glow: number;
  erodeScale: number;
  erodeSoftness: number;
};

/** The badge is gone by 55% of the crossing… */
const OUT_END = 0.55;
/** …and the next one starts arriving at 45%, so they overlap for a beat. */
const IN_START = 0.45;

function smoothstep01(x: number) {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

/** Erosion of the badge that is leaving. Mirror image of `erodeIn`. */
function erodeOut(t: number) {
  return smoothstep01(t / OUT_END);
}

/** Erosion of the badge that is arriving. Mirror image of `erodeOut`. */
function erodeIn(t: number) {
  return 1 - smoothstep01((t - IN_START) / (1 - IN_START));
}

/**
 * Surface samples are cached per (variant, enamel colour, particle count):
 * walking a badge's ~200k triangles costs a couple of milliseconds, and
 * without the cache every switch would pay it again. Bounded so a leva colour
 * sweep can't grow it without limit.
 */
const CACHE_LIMIT = 8;
const sampleCache = new Map<string, BadgeSample>();

function cacheGet(key: string, count: number): BadgeSample | null {
  const hit = sampleCache.get(key);
  return hit && hit.count === count ? hit : null;
}

function cachePut(key: string, source: BadgeSample) {
  const count = source.count;
  const entry: BadgeSample = {
    positions: source.positions.slice(0, count * 3),
    colors: source.colors.slice(0, count * 3),
    count,
  };
  sampleCache.set(key, entry);
  if (sampleCache.size > CACHE_LIMIT) {
    const oldest = sampleCache.keys().next().value;
    if (oldest !== undefined) sampleCache.delete(oldest);
  }
}

function copyInto(target: BadgeSample, source: BadgeSample) {
  target.positions.set(source.positions);
  target.colors.set(source.colors);
  target.count = source.count;
}

const drawingBuffer = /* @__PURE__ */ new Vector2();

/**
 * One mounted badge, with the erosion shader patched into every material of
 * its subtree. The badge components themselves are untouched — they are
 * imported as-is and only ever wrapped.
 */
function ErodedBadge({
  slot,
  look,
  materials,
  register,
}: {
  slot: BadgeSlot;
  look: ErodeLookUniforms;
  materials: PinMaterialSettings;
  register: (variant: BadgeVariant, group: Group | null) => void;
}) {
  const group = useRef<Group>(null);
  const uniforms = useMemo(() => ({ ...slot.uniforms, ...look }), [slot.uniforms, look]);

  const patch = useCallback(
    (root: Group) => {
      root.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
        for (const material of mats) {
          if (material.userData.erodePatched) continue;
          material.userData.erodePatched = true;
          applyErode(material, uniforms);
        }
      });
    },
    [uniforms],
  );

  useLayoutEffect(() => {
    register(slot.variant, group.current);
    if (group.current) patch(group.current);
    return () => register(slot.variant, null);
  }, [patch, register, slot.variant]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;

    // Re-sweep: Text3D meshes appear late (font resolving through Suspense)
    // and must be patched before they are ever drawn.
    patch(g);

    // The noise field is sampled in badge space, so it sticks to the geometry
    // while the stage sways instead of sliding across it.
    g.updateWorldMatrix(true, false);
    slot.uniforms.uErodeRootInv.value.copy(g.matrixWorld).invert();

    // Fully eroded means every fragment would discard: skip the draw entirely.
    g.visible = slot.uniforms.uErode.value < 0.999;
  });

  return (
    <group ref={group}>
      <Suspense fallback={null}>
        <PinMaterialProvider value={slot.frozenMaterials ?? materials}>
          <Badge variant={slot.variant} />
        </PinMaterialProvider>
      </Suspense>
    </group>
  );
}

/**
 * Drives the crossing: advances `t`, fills the particle buffers when a new
 * crossing starts, and writes the handful of uniforms that everything else is
 * derived from. Nothing here allocates.
 */
export function BadgeTransition({
  variant,
  materials,
  settings,
  blur,
  replayRef,
}: {
  variant: BadgeVariant;
  materials: PinMaterialSettings;
  settings: TransitionSettings;
  /** The composer's dream-blur pass; null until the composer has mounted. */
  blur: RefObject<DreamBlurEffect | null>;
  /** Leva's replay button is wired through this ref. */
  replayRef: { current: () => void };
}) {
  const { slots, machine, request, crossSelf, settle } = useBadgeTransition(variant);

  // One cloud for the lifetime of the canvas: all buffers pre-allocated at
  // MAX_PARTICLES, refilled in place, never re-created per transition.
  const cloud = useMemo(() => new ParticleCloud(), []);

  const look = useMemo<ErodeLookUniforms>(
    () => ({
      uErodeScale: { value: 2.2 },
      uErodeSoftness: { value: 0.22 },
      uErodeBleed: { value: new Color() },
    }),
    [],
  );

  const groups = useRef(new Map<BadgeVariant, Group>());
  const register = useCallback((key: BadgeVariant, group: Group | null) => {
    if (group) groups.current.set(key, group);
    else groups.current.delete(key);
  }, []);

  // Refs so the frame loop reads the latest props without being rebuilt.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const materialsRef = useRef(materials);
  materialsRef.current = materials;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  /** Particle count locked in when a crossing starts, so both ends match. */
  const activeCount = useRef(0);

  useEffect(() => {
    request(variant, materialsRef.current);
  }, [variant, request]);

  replayRef.current = () => crossSelf(materialsRef.current);

  /** Enamel colour a given badge is actually wearing right now. */
  const enamelOf = useCallback((target: BadgeVariant) => {
    const slot = slotsRef.current.find((s) => s.variant === target);
    return slot?.frozenMaterials?.enamelColor ?? materialsRef.current.enamelColor;
  }, []);

  /**
   * Fills one end of the cloud. A cache hit is a memcpy; a miss walks the
   * badge's triangles, which costs a few milliseconds, so callers can refuse
   * to pay it right now by passing `allowSample = false`.
   */
  const fillEnd = useCallback(
    (target: BadgeSample, source: BadgeVariant, count: number, allowSample: boolean) => {
      const key = `${source}|${enamelOf(source)}|${count}`;
      const cached = cacheGet(key, count);
      if (cached) {
        copyInto(target, cached);
        return true;
      }
      if (!allowSample) return false;
      const root = groups.current.get(source);
      if (!root) return false;
      if (!sampleBadgeSurface(root, count, target)) return false;
      cachePut(key, target);
      return true;
    },
    [enamelOf],
  );

  /** Idle warm-up bookkeeping, so the first switch is a cache hit too. */
  const warmKey = useRef("");
  const warmDelay = useRef(0.35);

  useFrame((state, delta) => {
    const m: TransitionMachine = machine.current;
    const s = settingsRef.current;
    const u = cloud.uniforms;

    // Look uniforms are shared by reference, so leva edits are plain writes.
    u.uTime.value = state.clock.elapsedTime;
    u.uDrift.value = s.drift;
    u.uTurbulence.value = s.turbulence;
    u.uLift.value = s.lift;
    u.uStagger.value = s.stagger;
    u.uSize.value = s.particleSize;
    u.uGlow.value = s.glow;
    look.uErodeScale.value = s.erodeScale;
    look.uErodeSoftness.value = s.erodeSoftness;
    // The badge's thinning frontier gets a faint ember haze in the same colour
    // family as the cloud, pushed past the bloom threshold by the glow control.
    look.uErodeBleed.value.copy(EMBER).multiplyScalar(s.glow * 0.35);

    const size = state.gl.getDrawingBufferSize(drawingBuffer);
    const fov = "fov" in state.camera ? (state.camera.fov as number) : 45;
    u.uPixelsPerUnit.value = (size.y * 0.5) / Math.tan((fov * Math.PI) / 360);

    // Mirrored crossings swap the two ends of the buffers, no copies.
    while (m.flips > 0) {
      cloud.swap();
      m.flips--;
    }

    if (m.active) {
      if (m.needsFrom && m.from) {
        activeCount.current = Math.min(Math.round(s.particleCount), cloud.max);
        const count = activeCount.current;
        if (!fillEnd(cloud.from, m.from, count, true)) fillFallbackCloud(count, cloud.from);
        cloud.uploadFrom();
        cloud.setDrawCount(count);
        m.needsFrom = false;
      }

      if (m.needsTo) {
        const count = activeCount.current;
        // If the incoming badge has never been sampled, the walk is deferred a
        // beat: by then the cloud is dispersed and blurred, so the few
        // milliseconds it costs land where they cannot be seen.
        if (fillEnd(cloud.to, m.to, count, m.t > 0.12)) {
          cloud.uploadTo();
          m.needsTo = false;
        } else if (m.t > 0.35) {
          // Geometry still not ready (first-ever font load): give the cloud
          // somewhere coherent to land rather than stalling the crossing.
          fillFallbackCloud(count, cloud.to);
          cloud.uploadTo();
          m.needsTo = false;
        }
      }

      m.t = Math.min(1, m.t + delta / Math.max(s.duration, 0.05));
    }

    const t = m.t;
    u.uProgress.value = t;

    for (const slot of slotsRef.current) {
      let erode = 1;
      if (m.active) {
        // A slot can be both ends at once (replay), in which case it has to
        // leave *and* come back — the lower visibility of the two wins.
        if (slot.variant === m.from) erode = Math.min(erode, erodeOut(t));
        if (slot.variant === m.to) erode = Math.min(erode, erodeIn(t));
      } else {
        erode = slot.variant === m.to ? 0 : 1;
      }
      slot.uniforms.uErode.value = erode;
    }

    // Soft-focus envelope: zero at both ends, peak in the middle of the
    // crossing, with a flat-ish top from the low exponent.
    const dream = blur.current;
    if (dream) {
      dream.radius = s.blurRadius;
      dream.halation = s.halation;
      dream.amount = m.active ? Math.pow(Math.sin(Math.PI * t), 0.7) * s.blur : 0;
    }

    if (m.active) {
      if (t >= 1) {
        cloud.setDrawCount(0);
        settle(materialsRef.current);
      }
      return;
    }

    cloud.setDrawCount(0);

    // Idle warm-up: sample the resting badge once its look has settled, so the
    // first switch away from it is a cache hit like every later one. The delay
    // is what keeps a leva colour drag from re-sampling every frame.
    const count = Math.min(Math.round(s.particleCount), cloud.max);
    const key = `${m.to}|${enamelOf(m.to)}|${count}`;
    if (warmKey.current !== key) {
      warmKey.current = key;
      warmDelay.current = 0.35;
    } else if (warmDelay.current > 0) {
      warmDelay.current -= delta;
      if (warmDelay.current <= 0) fillEnd(cloud.from, m.to, count, true);
    }
  });

  return (
    <>
      {slots.map((slot) => (
        <ErodedBadge
          key={slot.variant}
          slot={slot}
          look={look}
          materials={materials}
          register={register}
        />
      ))}
      <points geometry={cloud.geometry} material={cloud.material} frustumCulled={false} />
    </>
  );
}
