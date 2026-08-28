import { BufferAttribute, BufferGeometry, NormalBlending, ShaderMaterial } from "three";
import type { BadgeSample } from "./badgeSurface";

/**
 * The deforming mass.
 *
 * The badge does not scatter: it *melts*. Mid-crossing every point is pulled
 * onto one rounded body centred on the badge, deformed by a single shared
 * low-frequency field, and released in a smooth top-to-bottom wave rather than
 * at random per-particle times. Neighbours therefore move together, which is
 * what separates "sculpted mass" from "dust".
 *
 * One `Points` object is reused for the entire lifetime of the page. Every
 * buffer is allocated once at `MAX_PARTICLES` and refilled in place, and the
 * per-frame work is a handful of uniform writes — all of the motion is
 * computed in the vertex shader from three static attributes:
 *
 * - `position`  the point on the outgoing badge's surface (badge space),
 * - `aTo`       the point on the incoming badge's surface,
 * - `aColorFrom` / `aColorTo` the source material colours of both,
 * - `aSeed`     three per-particle randoms (stagger, phase, size/drift).
 *
 * A particle therefore only ever *interpolates* between two known surfaces:
 * whatever it does in between (collapse into the mass, deformation, buoyancy)
 * is multiplied by `sin(pi * t)`, which is zero at both ends. So it always
 * lands exactly on the incoming badge, no integration, no drift accumulation,
 * and the path is perfectly symmetric — which is what makes a mid-flight
 * reversal (rapid leva switching back) continuous rather than a jump.
 *
 * The wave phase is read from the *midpoint* of the two ends, not from either
 * one, so it survives that reversal unchanged as well.
 */

export const MAX_PARTICLES = 8000;

export type ParticleUniforms = {
  uProgress: { value: number };
  uTime: { value: number };
  /** How strongly the surface collapses onto the rounded mass mid-crossing. */
  uCohesion: { value: number };
  /** Radius of that mass. */
  uBlobSize: { value: number };
  /** Amplitude of the shared deformation field. */
  uTurbulence: { value: number };
  /** Frequency of that field. Low means large, coordinated lobes. */
  uTurbulenceScale: { value: number };
  uLift: { value: number };
  /** Width of the release wave, 0 = every point moves at once. */
  uWave: { value: number };
  uSize: { value: number };
  uPixelsPerUnit: { value: number };
  uGlow: { value: number };
  /** Melt contraction of each end, matching the badges' own scale. */
  uFromScale: { value: number };
  uToScale: { value: number };
};

const VERTEX = /* glsl */ `
attribute vec3 aTo;
attribute vec3 aColorFrom;
attribute vec3 aColorTo;
attribute vec3 aSeed;

uniform float uProgress;
uniform float uTime;
uniform float uCohesion;
uniform float uBlobSize;
uniform float uTurbulence;
uniform float uTurbulenceScale;
uniform float uLift;
uniform float uWave;
uniform float uSize;
uniform float uPixelsPerUnit;
uniform float uGlow;
uniform float uFromScale;
uniform float uToScale;

varying vec3 vColor;
varying float vAlpha;

const float PI = 3.1415926;

float smootherstep(const in float x) {
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

void main() {
  // Both ends carry the same melt contraction their badge is under, so the
  // surface points stay glued to the geometry as it shrinks away / swells in.
  vec3 pFrom = position * uFromScale;
  vec3 pTo = aTo * uToScale;

  // Read the wave phase off the midpoint of the two ends: swap-invariant, so
  // mirroring a crossing does not reshuffle who moves when.
  vec3 mid = (pFrom + pTo) * 0.5;

  // The mass gives way in a smooth vertical sweep, only lightly broken up per
  // particle — a wave, not a shuffle.
  float phase = clamp(mid.y * 0.45 + 0.5, 0.0, 1.0);
  phase = mix(phase, aSeed.x, 0.2);

  // Symmetric wave: a late particle also arrives early, so t -> 1 - t mirrors
  // the whole mass exactly and reversals stay seamless.
  float pad = phase * uWave * 0.5;
  float tp = clamp((uProgress - pad) / max(1.0 - 2.0 * pad, 0.001), 0.0, 1.0);
  float e = smootherstep(tp);
  float arc = sin(PI * tp);

  vec3 base = mix(pFrom, pTo, e);

  // Cohesion: halfway across, the badge is squeezed into one rounded body.
  // Not a projection onto a shell — that would hollow a flat badge out into a
  // ring — but a radial compression: the further out a point starts the
  // further out it stays, so the interior stays filled and the body reads as
  // solid matter. The badge is thin in z, so a static per-particle offset
  // gives the mass its depth.
  float r = length(base);
  vec3 unit = normalize(vec3(base.xy, base.z + (aSeed.y - 0.5) * 0.85) + vec3(0.0001));
  vec3 blob = unit * uBlobSize * pow(clamp(r / 1.15, 0.0, 1.0), 0.6);
  base = mix(base, blob, arc * uCohesion);

  // One shared low-frequency field, slowly advected: large lobes that whole
  // regions ride together, so the body wobbles like soft matter.
  vec3 q = base * uTurbulenceScale + uTime * 0.12;
  vec3 flow = vec3(
    sin(q.y) + cos(q.z),
    sin(q.z) + cos(q.x),
    sin(q.x) + cos(q.y)
  );
  base += flow * arc * uTurbulence;

  // The mass drifts up a little as it hangs.
  base.y += arc * uLift;

  vec4 mv = modelViewMatrix * vec4(base, 1.0);
  gl_Position = projectionMatrix * mv;

  vColor = mix(aColorFrom, aColorTo, e) * uGlow;
  // Invisible at both ends, solid through the middle. The exponent keeps the
  // matter from appearing over a badge that is still nearly whole.
  vAlpha = pow(arc, 0.7);

  float size = uSize * (0.8 + 0.4 * aSeed.z) * (0.75 + 0.25 * arc);
  gl_PointSize = clamp(size * uPixelsPerUnit / max(-mv.z, 0.05), 1.0, 96.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  // A solid core with a soft rim: overlapping sprites merge into continuous
  // matter instead of reading as a field of individual glowing dots.
  float mask = smoothstep(0.25, 0.05, r2);
  gl_FragColor = vec4(vColor, mask * vAlpha);
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
      uCohesion: { value: 0.72 },
      uBlobSize: { value: 0.62 },
      uTurbulence: { value: 0.12 },
      uTurbulenceScale: { value: 0.9 },
      uLift: { value: 0.12 },
      uWave: { value: 0.35 },
      uSize: { value: 0.055 },
      uPixelsPerUnit: { value: 500 },
      uGlow: { value: 1 },
      uFromScale: { value: 1 },
      uToScale: { value: 1 },
    };

    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      // Normal blending, not additive: the mass has to read as matter lit by
      // the studio, not as a spray of light. Bloom then only catches it when
      // the glow control is pushed past the threshold on purpose.
      blending: NormalBlending,
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
