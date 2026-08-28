import type { Color, Material, Matrix4 } from "three";

/**
 * Dissolve-transition shader injection.
 *
 * Instead of swapping every badge material for a custom ShaderMaterial (and
 * losing the PBR lighting that sells the metals and enamel), a small chunk is
 * injected into the existing materials via `onBeforeCompile`:
 *
 * - vertex: capture the fragment position in *badge space* — world position
 *   multiplied by the inverse of the badge root's world matrix — so the noise
 *   pattern sticks to the geometry while the stage sways.
 * - fragment: sample one octave of 3D simplex noise, discard fragments below
 *   the moving threshold, and pour an HDR emissive colour into the narrow band
 *   right at the frontier so the existing Bloom pass picks it up as a glowing
 *   burn edge.
 *
 * `uProgress` runs 0 → 1 (fully present → fully gone). The threshold is
 * remapped to [-edgeWidth, 1+ε] so that at 0 nothing glows and at 1 nothing
 * survives.
 */

/** Per-badge-instance uniforms: each mounted badge animates its own dissolve. */
export type DissolveInstanceUniforms = {
  uDissolveProgress: { value: number };
  uDissolveRootInv: { value: Matrix4 };
};

/** Shared look uniforms: one set drives every instance, edited live via leva. */
export type DissolveAppearanceUniforms = {
  uDissolveNoiseScale: { value: number };
  uDissolveEdgeWidth: { value: number };
  uDissolveEdgeColor: { value: Color };
};

export type DissolveUniforms = DissolveInstanceUniforms & DissolveAppearanceUniforms;

/** Ashima/IQ 3D simplex noise — the single noise function used by the effect. */
const NOISE_GLSL = /* glsl */ `
vec3 dperm3(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 dperm4(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 dTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float dissolveSnoise(vec3 v) {
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
  vec4 p = dperm4(dperm4(dperm4(i.z + vec4(0.0, i1.z, i2.z, 1.0))
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

  vec4 norm = dTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const VERTEX_HEAD = /* glsl */ `
varying vec3 vDissolvePos;
uniform mat4 uDissolveRootInv;
`;

const VERTEX_BODY = /* glsl */ `
vDissolvePos = (uDissolveRootInv * modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vDissolvePos;
uniform float uDissolveProgress;
uniform float uDissolveNoiseScale;
uniform float uDissolveEdgeWidth;
uniform vec3 uDissolveEdgeColor;
${NOISE_GLSL}
`;

/** Runs first thing inside main(); `dissolveEdge` stays in scope for later. */
const FRAGMENT_TEST = /* glsl */ `
float dissolveNoise = dissolveSnoise(vDissolvePos * uDissolveNoiseScale) * 0.5 + 0.5;
float dissolveThreshold = mix(-uDissolveEdgeWidth - 0.002, 1.002, uDissolveProgress);
float dissolveDelta = dissolveNoise - dissolveThreshold;
if (dissolveDelta < 0.0) discard;
float dissolveEdge = 1.0 - smoothstep(0.0, uDissolveEdgeWidth, dissolveDelta);
`;

/** Added after the stock emissive chunk so the edge feeds lighting + bloom. */
const FRAGMENT_EDGE = /* glsl */ `
totalEmissiveRadiance += uDissolveEdgeColor * dissolveEdge;
`;

/**
 * Patch one material in place. The uniform *objects* are shared by reference,
 * so animating `uniforms.uDissolveProgress.value` drives every material of a
 * badge instance with zero per-frame material work.
 */
export function applyDissolve(material: Material, uniforms: DissolveUniforms) {
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
        `#include <emissivemap_fragment>\n${FRAGMENT_EDGE}`,
      );
  };
  // All patched programs share one cache-key suffix; three still splits the
  // key by material class/features, so standard vs physical compile separately.
  material.customProgramCacheKey = () => "dissolve";
  material.needsUpdate = true;
}
