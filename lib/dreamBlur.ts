import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Uniform } from "three";

/**
 * Dream blur — the transient soft-focus pass.
 *
 * The brief for the transition is "disfuminado, medio parecido a un sueño", so
 * the whole frame goes out of focus while the badge is a cloud of embers, then
 * comes back. Three things happen at once, all driven by one `amount`
 * envelope that the transition ramps in and out:
 *
 * - a 13-tap two-ring blur of the composer's input buffer, mixed over the
 *   sharp image;
 * - halation: the blurred image added back on top, so the bright particles
 *   bleed a warm haze into their surroundings (this runs before Bloom in the
 *   chain, so Bloom then picks the haze up as well);
 * - a soft vignette that closes in slightly, which is what makes it read as a
 *   memory rather than as a broken camera.
 *
 * Implementation notes:
 * - it is a merged `Effect`, not a `Pass`, so it adds no render targets at
 *   all; it reads the buffer the composer already has;
 * - the tap ring is rotated per pixel by a hash, so 13 taps look like a smooth
 *   defocus instead of a 6-pointed star, at a fraction of a gaussian's cost;
 * - `EffectAttribute.CONVOLUTION` is declared because it samples neighbours.
 *   Bloom and ToneMapping are not convolution effects, so all three still
 *   merge into a single EffectPass;
 * - the whole body is behind `amount > 0`, a uniform (screen-coherent) branch,
 *   so an idle frame costs one comparison.
 */

const FRAGMENT = /* glsl */ `
uniform float amount;
uniform float radius;
uniform float halation;
uniform float vignette;

float dreamHash(const in vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (amount < 0.002) {
    outputColor = inputColor;
    return;
  }

  float spread = amount * radius;
  float phase = dreamHash(gl_FragCoord.xy) * 6.2831853;

  vec3 sum = inputColor.rgb;
  float weight = 1.0;

  // Two rings of six taps: the inner ring keeps the shape readable, the outer
  // one supplies the haze. Both are rotated by the per-pixel phase.
  for (int i = 0; i < 6; i++) {
    float angle = phase + float(i) * 1.0471976;
    vec2 dir = vec2(cos(angle), sin(angle));

    vec2 inner = dir * spread * 0.5 * texelSize;
    sum += texture2D(inputBuffer, uv + inner).rgb;
    weight += 1.0;

    vec2 outer = vec2(-dir.y, dir.x) * spread * texelSize;
    sum += texture2D(inputBuffer, uv + outer).rgb * 0.65;
    weight += 0.65;
  }

  vec3 blurred = sum / weight;
  vec3 color = mix(inputColor.rgb, blurred, min(amount, 1.0));
  color += blurred * halation * amount;

  float d = length((uv - 0.5) * vec2(aspect, 1.0));
  color *= 1.0 - vignette * amount * smoothstep(0.18, 0.95, d);

  outputColor = vec4(color, inputColor.a);
}
`;

export type DreamBlurOptions = {
  /** Blur envelope, 0 = untouched frame, 1 = full dream. */
  amount?: number;
  /** Maximum tap spread in pixels at `amount = 1`. */
  radius?: number;
  /** How much of the blurred image is added back as glow. */
  halation?: number;
  /** Strength of the closing vignette. */
  vignette?: number;
};

export class DreamBlurEffect extends Effect {
  constructor({ amount = 0, radius = 14, halation = 0.35, vignette = 0.5 }: DreamBlurOptions = {}) {
    super("DreamBlurEffect", FRAGMENT, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ["amount", new Uniform(amount)],
        ["radius", new Uniform(radius)],
        ["halation", new Uniform(halation)],
        ["vignette", new Uniform(vignette)],
      ]),
    });
  }

  private uniform(name: string): Uniform<number> {
    return this.uniforms.get(name) as Uniform<number>;
  }

  get amount(): number {
    return this.uniform("amount").value;
  }

  set amount(value: number) {
    this.uniform("amount").value = value;
  }

  get radius(): number {
    return this.uniform("radius").value;
  }

  set radius(value: number) {
    this.uniform("radius").value = value;
  }

  get halation(): number {
    return this.uniform("halation").value;
  }

  set halation(value: number) {
    this.uniform("halation").value = value;
  }

  get vignette(): number {
    return this.uniform("vignette").value;
  }

  set vignette(value: number) {
    this.uniform("vignette").value = value;
  }
}
