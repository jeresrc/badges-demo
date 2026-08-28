import type { Color, Material, Matrix4 } from "three";

/**
 * Badge erosion — the half of the transition that happens *on the badge*.
 *
 * The particles carry the transition, but the badge itself still has to leave
 * and arrive, and it must not pop. Fading opacity is not an option: these are
 * 30+ overlapping opaque pieces plus two transmissive materials, so alpha
 * blending would sort wrong and the clearcoat would go milky.
 *
 * So instead of touching blending at all, a chunk is injected into the stock
 * materials via `onBeforeCompile` and fragments are discarded below a moving
 * noise threshold. Two things keep it dreamy rather than sci-fi:
 *
 * - the frontier is *stochastic*: a per-pixel hash offsets the cut inside a
 *   soft band, so the boundary is a grain gradient (film dissolve) instead of
 *   a crisp contour, which the transition blur then smears into a haze;
 * - two octaves of noise at a low scale make the eaten regions big and cloudy,
 *   so the badge thins out like a memory instead of burning away.
 *
 * `uErode` runs 0 (fully present) → 1 (fully gone). Every fragment cost is
 * behind `if (uErode > 0)`, so an idle badge pays nothing.
 */

/** Per-badge uniforms: each mounted badge erodes on its own clock. */
export type ErodeInstanceUniforms = {
  uErode: { value: number };
  uErodeRootInv: { value: Matrix4 };
};

/** Shared look uniforms: one set for every badge, mutated live from leva. */
export type ErodeLookUniforms = {
  uErodeScale: { value: number };
  uErodeSoftness: { value: number };
  uErodeBleed: { value: Color };
};

export type ErodeUniforms = ErodeInstanceUniforms & ErodeLookUniforms;

/** Ashima/IQ 3D simplex noise — the one noise function the effect needs. */
const NOISE_GLSL = /* glsl */ `
vec4 eperm4(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 eTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float erodeSnoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

  i = mod(i, 289.0);
  vec4 p = eperm4(eperm4(eperm4(i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = eTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float erodeHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
`;

const VERTEX_HEAD = /* glsl */ `
varying vec3 vErodePos;
uniform mat4 uErodeRootInv;
`;

/** Badge-space position: world position pulled back through the badge root, so
 *  the noise field sticks to the geometry while the stage sways. */
const VERTEX_BODY = /* glsl */ `
vErodePos = (uErodeRootInv * modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vErodePos;
uniform float uErode;
uniform float uErodeScale;
uniform float uErodeSoftness;
uniform vec3 uErodeBleed;
${NOISE_GLSL}
`;

/** Runs first inside main(); `erodeBleed` stays in scope for the emissive hook. */
const FRAGMENT_TEST = /* glsl */ `
float erodeBleed = 0.0;
if (uErode > 0.0005) {
  float erodeN = erodeSnoise(vErodePos * uErodeScale) * 0.5 + 0.5;
  erodeN = mix(erodeN, erodeSnoise(vErodePos * uErodeScale * 2.6 + 17.0) * 0.5 + 0.5, 0.35);
  float erodeW = uErodeSoftness;
  // The ramp overshoots the noise range at both ends, so uErode = 0 cannot
  // speckle a badge that is meant to be whole, and 1 leaves nothing behind.
  float erodeThreshold = mix(-erodeW - 0.02, 1.02 + erodeW, uErode);
  float erodeD = erodeN - erodeThreshold;
  // Stochastic cut: the frontier becomes a band of grain instead of a hard
  // contour. Kept narrow — enough to break the edge, not enough to read as
  // noise once the soft focus is on it.
  if (erodeD < erodeHash(gl_FragCoord.xy) * erodeW * 0.6) discard;
  erodeBleed = 1.0 - smoothstep(0.0, erodeW * 2.0, erodeD);
  erodeBleed *= erodeBleed;
}
`;

/** Added after the stock emissive chunk: a faint warm haze where the badge is
 *  thinning out, matching the particle colour and feeding the existing bloom. */
const FRAGMENT_BLEED = /* glsl */ `
totalEmissiveRadiance += uErodeBleed * erodeBleed;
`;

/**
 * Patch one material in place. The uniform *objects* are shared by reference,
 * so the whole badge animates by writing a single number per frame.
 */
export function applyErode(material: Material, uniforms: ErodeUniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_BODY}`);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
      .replace(
        "#include <clipping_planes_fragment>",
        `${FRAGMENT_TEST}\n#include <clipping_planes_fragment>`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\n${FRAGMENT_BLEED}`,
      );
  };
  // One shared cache-key suffix; three still splits by material class and
  // feature set, so standard vs physical compile separately as usual.
  material.customProgramCacheKey = () => "erode";
  material.needsUpdate = true;
}
