/**
 * Shared fragment-shader preamble for every plate atmosphere.
 * Split out of atmosphere.mjs so the lab catalogue can import it without a cycle
 * through plateMotion (which lists the promoted fields).
 */
export const GLSL_PREAMBLE = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uGold;
uniform vec3 uAmber;
uniform vec3 uTeal;
uniform vec3 uInk;
uniform vec3 uSurface;
uniform float uOpacity;
uniform float uDrift;
uniform float uEnv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
/* Wide soft dim where the copy sits — the field never competes with the words. */
float contentDim(vec2 uv){
  vec2 band = (uv - vec2(0.5, 0.46)) * vec2(0.72, 1.05);
  return mix(0.36, 1.0, smoothstep(0.08, 0.95, length(band)));
}
float vignette(vec2 p){ return smoothstep(1.35, 0.25, length(p * vec2(0.72, 1.0))); }
float sdRoundBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float easeInOut(float x){ return x * x * (3.0 - 2.0 * x); }
`;
