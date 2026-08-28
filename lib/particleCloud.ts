import { AdditiveBlending, BufferAttribute, BufferGeometry, ShaderMaterial } from "three";
import type { BadgeSample } from "./badgeSurface";

/**
 * The ember cloud.
 *
 * One `Points` object is reused for the entire lifetime of the page. Every
 * buffer is allocated once at `MAX_PARTICLES` and refilled in place, and the
 * per-frame work is nine uniform writes — all of the motion is computed in the
 * vertex shader from three static attributes:
 *
 * - `position`  the point on the outgoing badge's surface (badge space),
 * - `aTo`       the point on the incoming badge's surface,
 * - `aColorFrom` / `aColorTo` the source material colours of both,
 * - `aSeed`     three per-particle randoms (stagger, phase, size/drift).
 *
 * A particle therefore only ever *interpolates* between two known surfaces:
 * whatever it does in between (outward puff, curl turbulence, buoyancy) is
 * multiplied by `sin(pi * t)`, which is zero at both ends. So it always lands
 * exactly on the incoming badge, no integration, no drift accumulation, and
 * the path is perfectly symmetric — which is what makes a mid-flight reversal
 * (rapid leva switching back) continuous rather than a jump.
 */

export const MAX_PARTICLES = 8000;

export type ParticleUniforms = {
  uProgress: { value: number };
  uTime: { value: number };
  uDrift: { value: number };
  uTurbulence: { value: number };
  uLift: { value: number };
  uStagger: { value: number };
  uSize: { value: number };
  uPixelsPerUnit: { value: number };
  uGlow: { value: number };
};

const VERTEX = /* glsl */ `
attribute vec3 aTo;
attribute vec3 aColorFrom;
attribute vec3 aColorTo;
attribute vec3 aSeed;

uniform float uProgress;
uniform float uTime;
uniform float uDrift;
uniform float uTurbulence;
uniform float uLift;
uniform float uStagger;
uniform float uSize;
uniform float uPixelsPerUnit;
uniform float uGlow;

varying vec3 vColor;
varying float vAlpha;

const float PI = 3.1415926;

float smootherstep(const in float x) {
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

void main() {
  // Symmetric stagger: a late particle also arrives early, so t -> 1 - t
  // mirrors the whole cloud exactly and reversals stay seamless.
  float pad = aSeed.x * uStagger * 0.5;
  float tp = clamp((uProgress - pad) / max(1.0 - 2.0 * pad, 0.001), 0.0, 1.0);
  float e = smootherstep(tp);
  float arc = sin(PI * tp);

  vec3 base = mix(position, aTo, e);

  // Dispersal direction: mostly away from the badge centre, partly a fixed
  // random bearing, so the cloud puffs apart instead of inflating as a shell.
  vec3 radial = normalize(base + vec3(0.0001, 0.0002, 0.0001));
  vec3 bearing = normalize(vec3(
    sin(aSeed.y * 43.0 + 1.7),
    cos(aSeed.z * 37.0 + 3.1),
    sin(aSeed.y * 29.0 + aSeed.z * 11.0)
  ) + vec3(0.0001));
  vec3 dir = normalize(mix(radial, bearing, 0.55));
  base += dir * arc * uDrift * (0.45 + aSeed.z);

  // Cheap curl-flavoured field, slowly advected in time: gentle, non-uniform
  // wander that keeps neighbouring particles from moving as a rigid block.
  vec3 q = base * 1.7 + uTime * 0.25 + aSeed.y * 6.2831853;
  vec3 turbulence = vec3(
    sin(q.y) + cos(q.z * 1.3),
    sin(q.z) + cos(q.x * 1.1),
    sin(q.x) + cos(q.y * 1.7)
  );
  base += turbulence * arc * uTurbulence * 0.35;

  // Embers rise slightly on the way across.
  base.y += arc * uLift * (0.4 + aSeed.y * 0.8);

  vec4 mv = modelViewMatrix * vec4(base, 1.0);
  gl_Position = projectionMatrix * mv;

  vColor = mix(aColorFrom, aColorTo, e) * uGlow;
  // Invisible at both ends, brightest in the middle of the crossing.
  vAlpha = pow(arc, 0.55);

  float size = uSize * (0.55 + aSeed.z * 0.9) * (0.45 + 0.55 * arc);
  gl_PointSize = clamp(size * uPixelsPerUnit / max(-mv.z, 0.05), 1.0, 64.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  // Squared radial falloff: no hard rim, so the sprites read as soft motes
  // and stack into a haze that the bloom and the dream blur can pick up.
  float mask = 1.0 - r2 * 4.0;
  mask *= mask;
  gl_FragColor = vec4(vColor * mask * vAlpha, mask * vAlpha);
}
`;

export class ParticleCloud {
  readonly geometry = new BufferGeometry();
  readonly material: ShaderMaterial;
  readonly uniforms: ParticleUniforms;
  readonly max: number;

  private readonly positionA: BufferAttribute;
  private readonly positionB: BufferAttribute;
  private readonly colorA: BufferAttribute;
  private readonly colorB: BufferAttribute;
  private readonly sampleA: BadgeSample;
  private readonly sampleB: BadgeSample;
  private flipped = false;

  constructor(max = MAX_PARTICLES) {
    this.max = max;

    this.positionA = new BufferAttribute(new Float32Array(max * 3), 3);
    this.positionB = new BufferAttribute(new Float32Array(max * 3), 3);
    this.colorA = new BufferAttribute(new Float32Array(max * 3), 3);
    this.colorB = new BufferAttribute(new Float32Array(max * 3), 3);

    this.sampleA = {
      positions: this.positionA.array as Float32Array,
      colors: this.colorA.array as Float32Array,
      count: 0,
    };
    this.sampleB = {
      positions: this.positionB.array as Float32Array,
      colors: this.colorB.array as Float32Array,
      count: 0,
    };

    const seeds = new Float32Array(max * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    this.geometry.setAttribute("aSeed", new BufferAttribute(seeds, 3));
    this.bind();
    this.geometry.setDrawRange(0, 0);

    this.uniforms = {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uDrift: { value: 0.45 },
      uTurbulence: { value: 0.28 },
      uLift: { value: 0.22 },
      uStagger: { value: 0.45 },
      uSize: { value: 0.03 },
      uPixelsPerUnit: { value: 500 },
      uGlow: { value: 2.2 },
    };

    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
  }

  private bind() {
    const { flipped, positionA, positionB, colorA, colorB, geometry } = this;
    geometry.setAttribute("position", flipped ? positionB : positionA);
    geometry.setAttribute("aTo", flipped ? positionA : positionB);
    geometry.setAttribute("aColorFrom", flipped ? colorB : colorA);
    geometry.setAttribute("aColorTo", flipped ? colorA : colorB);
  }

  /** Buffers the outgoing badge writes into. */
  get from(): BadgeSample {
    return this.flipped ? this.sampleB : this.sampleA;
  }

  /** Buffers the incoming badge writes into. */
  get to(): BadgeSample {
    return this.flipped ? this.sampleA : this.sampleB;
  }

  uploadFrom() {
    (this.flipped ? this.positionB : this.positionA).needsUpdate = true;
    (this.flipped ? this.colorB : this.colorA).needsUpdate = true;
  }

  uploadTo() {
    (this.flipped ? this.positionA : this.positionB).needsUpdate = true;
    (this.flipped ? this.colorA : this.colorB).needsUpdate = true;
  }

  /** Reverses the crossing: zero copies, the two ends just change roles. */
  swap() {
    this.flipped = !this.flipped;
    this.bind();
  }

  setDrawCount(count: number) {
    this.geometry.setDrawRange(0, Math.max(0, Math.min(count, this.max)));
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
