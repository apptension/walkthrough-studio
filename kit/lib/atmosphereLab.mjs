/**
 * Atmosphere lab: candidate WebGL fields awaiting review before they join `ATMOSPHERES`.
 *
 * Every candidate honours the production contract in lib/atmosphere.mjs — same preamble, same
 * uniforms (five-colour scale, time, drift, opacity, envelope), straight-alpha `gl_FragColor` —
 * so an accepted field moves into the production table verbatim. The reference look is the
 * apptension.com wave field (posterized noise contours); the first four candidates port the
 * site's own shaders, the rest explore different vibes on the same quality bar: anti-aliased
 * hairlines, domain-warped noise, slow deterministic motion, colour from the brand scale only.
 *
 * Accepted fields (`PROMOTED_FIELDS`) ship in `ATMOSPHERES`. Everything else is still a candidate:
 * preview + accept with `node scripts/atmosphere-lab.mjs --open`.
 *
 * Brand + tuning contract (what makes a field "adjustable" without touching GLSL):
 *   - Colour comes only from the brand uniforms — uGold (accent), uAmber (secondary), uTeal
 *     (support), uInk, uSurface. No field hard-codes a hue; vec3(0.0) / vec3(1.0) are the only
 *     neutral literals allowed (accumulators and highlight lift). Swap `brand.json → colors` or
 *     `direction.colors` and every field recolours.
 *   - `opacity` below is the default presence; `motion.atmosphereOpacity` (Studio "Presence",
 *     CLI `--presence`) overrides it per video or per plate.
 *   - Tempo is `motion.atmosphereSpeed` (Studio "Speed", CLI `--speed`) × `uDrift` from the energy
 *     profile; every body derives its clock from `uTime * k * uDrift` so both knobs apply.
 *   - `uEnv` is the plate's in/out envelope; alpha is always multiplied by
 *     `vignette · contentDim · uOpacity · uEnv` so copy stays readable and plates fade cleanly.
 */
import { GLSL_PREAMBLE } from './atmosphereGlsl.mjs';

/** Ashima 3D simplex noise — the apptension.com contour field is built on it. */
const GLSL_SIMPLEX = `
vec4 permute(vec4 x){ return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
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
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

/** Shared helpers the candidates lean on beyond the production preamble. */
const GLSL_LAB_COMMON = `
#define TAU 6.28318530718
vec2 hash2(vec2 p){ return vec2(hash(p), hash(p + 7.31)); }
/* Signal-field domain warp (apptension.com SignalField / BinaryRippleField). */
float signalField(vec2 p, float t, out vec2 q){
  q = p * 0.8;
  float warp = fbm(q + vec2(t * 0.4, 0.0));
  q += 0.2 * vec2(warp, fbm(q + vec2(2.3 + warp, t * 0.3)));
  return fbm(q * 2.15 + vec2(t * 0.14, -t * 0.07));
}
/* Six drifting node centres from the same field (CPU uniforms on the site, pure time here). */
vec2 signalNode(int i, float t){
  float fi = float(i);
  float ang = fi * 2.399963 + t * 0.15;
  float rad = 0.18 + 0.22 * fract(sin(fi * 19.13) * 43758.5453);
  return vec2(cos(ang) * rad + 0.07 * sin(t * 0.9 + fi), sin(ang * 1.3) * rad + 0.07 * cos(t * 0.75 + fi * 0.6));
}
float aaLine(float v, float width){
  float d = abs(fract(v) - 0.5);
  float fw = fwidth(v) * 1.1;
  return 1.0 - smoothstep(width, width + fw, d);
}
`;

/**
 * Candidate table. `vibe` groups the previewer; `opacity` is the production default should the
 * field be accepted. Bodies assume the preamble + lab helpers.
 */
export const LAB_FIELDS = Object.freeze([
  /* —————————————————————————————— apptension.com ports —————————————————————————————— */
  {
    id: 'contour',
    label: 'Contour',
    hint: 'apptension.com wave field — posterized simplex contours',
    vibe: 'apptension.com',
    opacity: 0.42,
    body: `${GLSL_SIMPLEX}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.07 * uDrift;
  vec2 q = uv * vec2(aspect, 1.0) * 2.5 + 11.0;
  float n = snoise(vec3(q, t)) * 0.6 + snoise(vec3(q * 2.0, t)) * 0.24;
  n = (n + 1.0) * 0.5;
  float levels = 18.0;
  float post = floor(n * levels) / levels;
  float edge = abs(n - post);
  float aa = fwidth(n) * 1.2;
  float thick = 0.0045;
  float line = 1.0 - smoothstep(thick - aa, thick + aa, edge);
  float gradFactor = 0.6 + post * 0.4;
  vec3 col = mix(uGold, uTeal, clamp((uv.x + 1.0 - uv.y) * 0.5 + n * 0.15, 0.0, 1.0)) * gradFactor;
  float alpha = line * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'signal',
    label: 'Signal',
    hint: 'apptension.com SignalField — warped isobars, filaments, pulsing nodes',
    vibe: 'apptension.com',
    opacity: 0.44,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.12 * uDrift;
  vec2 q;
  float n = signalField(p, t, q);
  float n2 = fract(n * 3.0 + t * 0.05);
  float band = n * 12.0;
  float ridge = 1.0 - smoothstep(0.0, 0.07 + fwidth(band), abs(fract(band) - 0.5));
  float filament = smoothstep(0.42, 0.5, n2) * (1.0 - smoothstep(0.5, 0.58, n2));
  float nodes = 0.0;
  for (int i = 0; i < 6; i++) {
    float d = length(p - signalNode(i, t));
    float pulse = 0.55 + 0.45 * sin(t * 2.1 + float(i) * 1.7);
    nodes += (1.0 - smoothstep(0.0, 0.09, d)) * pulse;
  }
  float field = ridge * 0.85 + filament * 0.5 + nodes * 0.85;
  float gradT = clamp(uv.x * 0.7 + uv.y * 0.35 + n * 0.15, 0.0, 1.0);
  vec3 col = mix(uGold, uTeal, gradT) * (0.8 + field * 0.35);
  float alpha = (field * 0.5 + nodes * 0.1) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'halftone',
    label: 'Halftone',
    hint: 'apptension.com BinaryRipple — round dots riding the isobars',
    vibe: 'apptension.com',
    opacity: 0.5,
    body: `
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 halftoneCell(vec2 g){
  vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  f.x += step(1.0, mod(id.y, 2.0)) * 0.5;
  f.x -= step(0.5, f.x);
  float s = hash21(id); float s2 = hash21(id + 19.17);
  f -= (vec2(s, s2) - 0.5) * 0.16;
  return vec3(f, s);
}
float gdot(vec2 l, float r){ float r2 = max(r * r * 0.48, 1.0e-5); return exp(-dot(l, l) / r2); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.12 * uDrift;
  vec2 q;
  float n = signalField(p, t, q);
  float n2 = fract(n * 3.0 + t * 0.05);
  float levels = 12.0;
  float ridge = 1.0 - smoothstep(0.0, 0.07, abs(fract(n * levels) - 0.5));
  float ghost = 1.0 - smoothstep(0.0, 0.11, abs(fract(n * levels * 0.52 + 0.14) - 0.5));
  float filament = smoothstep(0.42, 0.5, n2) * (1.0 - smoothstep(0.5, 0.58, n2));
  vec2 grad = vec2(dFdx(n), dFdy(n));
  vec2 tangent = vec2(-grad.y, grad.x) / max(length(grad), 1.0e-5);
  vec3 cell = halftoneCell(p * 24.0 + tangent * (t * 2.4 * 0.018));
  float roundDot = gdot(cell.xy, mix(0.5, 0.64, cell.z));
  float nodeDots = 0.0;
  for (int i = 0; i < 6; i++) {
    float d = length(p - signalNode(i, t));
    float pulse = 0.55 + 0.45 * sin(t * 2.1 + float(i) * 1.7);
    nodeDots += gdot(vec2(d * 14.0, 0.0), 0.55) * pulse;
  }
  float dotField = roundDot * (ridge * 0.95 + ghost * 0.42) + filament * 0.48 + nodeDots * 0.75;
  float gradT = clamp(uv.x * 0.7 + uv.y * 0.35 + n * 0.15, 0.0, 1.0);
  vec3 col = mix(uGold, uTeal, gradT) * (0.85 + dotField * 0.25);
  float alpha = (dotField * 0.62 + nodeDots * 0.18) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'iridescent',
    label: 'Iridescent',
    hint: 'apptension.com case-study backdrop — soft diagonal bands with a spectral tint',
    vibe: 'apptension.com',
    opacity: 0.4,
    body: `
vec3 irid(float t){ return vec3(sin(t * TAU) * 0.5 + 0.5, sin(t * TAU + TAU / 3.0) * 0.5 + 0.5, sin(t * TAU + 2.0 * TAU / 3.0) * 0.5 + 0.5); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float time = uTime * 0.5 * uDrift;
  float w1 = pow(sin((uv.x + uv.y) * 8.0 - time * 0.8) * 0.5 + 0.5, 8.0);
  float w2 = pow(sin((uv.x - uv.y) * 6.0 + time * 0.6) * 0.5 + 0.5, 6.0);
  float n = fbm(uv * 3.0 + time * 0.1);
  float ang = atan(p.y, p.x) / TAU + 0.5 + time * 0.05;
  vec3 ir = irid(ang);
  float waves = w1 * 0.8 + w2 * 0.6;
  vec3 base = mix(uAmber, uTeal, n);
  vec3 col = mix(base, mix(base, ir, 0.5), 0.45);
  float scan = pow(sin(uv.y * 300.0 + time * 2.0) * 0.5 + 0.5, 20.0) * 0.04;
  float alpha = (waves * 0.9 + scan) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },

  /* ————————————————————————————————— line work ————————————————————————————————— */
  {
    id: 'silk',
    label: 'Silk',
    hint: 'Two dozen strands that bunch and breathe like silk threads',
    vibe: 'lines',
    opacity: 0.46,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p0 = (uv - 0.5) * vec2(aspect, 1.0);
  float a = -0.14;
  vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p0;
  float t = uTime * 0.3 * uDrift;
  float wave = fbm(vec2(p.x * 0.9 + t * 0.25, t * 0.1)) - 0.5;
  float wave2 = sin(p.x * 2.4 - t * 0.9);
  float fw = fwidth(p.y) * 1.6 + 0.0012;
  float acc = 0.0; vec3 colAcc = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    float fi = float(i); float k = fi / 23.0;
    float y = (k - 0.5) * 0.72 + wave * 0.36 * (0.5 + k) + wave2 * 0.06 * sin(k * TAU + t * 0.4)
            + 0.028 * sin(p.x * 7.0 + fi * 1.7 + t * 1.3) * (0.3 + 0.7 * k);
    float d = abs(p.y - y);
    float l = 1.0 - smoothstep(0.0, fw, d);
    float glow = exp(-d * 110.0) * 0.3;
    float bright = 0.4 + 0.6 * (0.5 + 0.5 * sin(fi * 2.1 + p.x * 1.5 + t * 0.7));
    float w = (l + glow) * bright;
    acc += w; colAcc += w * mix(uGold, uTeal, k);
  }
  vec3 col = colAcc / max(acc, 1.0e-3);
  float alpha = clamp(acc * 0.7, 0.0, 1.0) * vignette(p0) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, alpha);
}`,
  },
  {
    id: 'ridgelines',
    label: 'Ridgelines',
    hint: 'Stacked ridges that occlude each other — the pulsar-plot look',
    vibe: 'lines',
    opacity: 0.46,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.22 * uDrift;
  float fw = fwidth(p.y) * 1.5 + 0.0012;
  float line = 0.0; float fill = 0.0; float k = 0.0;
  float env = exp(-pow(p.x * 1.05, 2.0) * 1.4);
  for (int i = 0; i < 16; i++) {
    float fi = float(i); k = fi / 15.0;
    float base = -0.44 + k * 0.84;
    float h = fbm(vec2(p.x * 1.6 + fi * 3.1 + t * (0.3 + 0.02 * fi), fi * 0.7 + t * 0.06));
    float spike = pow(max(h - 0.42, 0.0) * 2.4, 1.6);
    float y = base + (h - 0.4) * 0.1 + spike * 0.3 * (0.2 + env);
    if (p.y < y) {
      float d = y - p.y;
      line = 1.0 - smoothstep(0.0, fw, d);
      fill = exp(-d * 16.0) * 0.3;
      break;
    }
  }
  float depth = 1.0 - k * 0.45;
  vec3 col = mix(uTeal, uGold, k * 0.8 + 0.1);
  float alpha = (line * 1.1 + fill) * depth * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'interference',
    label: 'Interference',
    hint: 'Ripples from three drifting sources crossing into fringes',
    vibe: 'lines',
    opacity: 0.38,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.5 * uDrift;
  float field = 0.0; float glow = 0.0; float near = 1.0e3;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(t * 0.31 + fi * 2.1) * 0.32 * aspect, cos(t * 0.23 + fi * 1.3) * 0.3);
    float d = length(p - c);
    near = min(near, d);
    field += sin(d * 30.0 - t * 2.0 + fi) * exp(-d * 0.9);
    glow += exp(-d * d * 60.0) * 0.5;
  }
  float v = field * 0.9;
  float d = abs(fract(v) - 0.5);
  float fw = fwidth(v) * 1.3 + 0.04;
  float line = 1.0 - smoothstep(0.0, fw, d);
  float bright = pow(clamp(0.5 + 0.5 * field / 2.2, 0.0, 1.0), 2.0);
  vec3 col = mix(uTeal, uGold, bright);
  col = mix(col, uAmber, glow * 0.6);
  float alpha = (line * (0.35 + 0.55 * bright) + glow * 0.35) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'warpstripes',
    label: 'Warp stripes',
    hint: 'Op-art diagonal stripes bent by a slow noise field',
    vibe: 'lines',
    opacity: 0.36,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.18 * uDrift;
  float w = fbm(p * 1.3 + vec2(t * 0.3, -t * 0.2));
  float w2 = fbm(p * 1.3 + vec2(5.2 - t * 0.2, t * 0.25));
  vec2 q = p + (vec2(w, w2) - 0.5) * 0.5;
  float a = 0.95;
  float s = dot(q, vec2(cos(a), sin(a))) * 34.0 + t * 0.8;
  float line = aaLine(s, 0.06);
  float squeeze = clamp(length(vec2(dFdx(s), dFdy(s))) * uRes.y * 0.0009, 0.0, 1.0);
  vec3 col = mix(uGold, uAmber, w) ;
  col = mix(col, uTeal, smoothstep(0.55, 0.9, w2) * 0.5);
  float alpha = line * (0.7 + 0.5 * squeeze) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'bend',
    label: 'Bend',
    hint: 'Swiss hairlines bowed by invisible lenses passing through',
    vibe: 'lines',
    opacity: 0.34,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.25 * uDrift;
  float dy = 0.0; float lensMask = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(t * (0.37 + fi * 0.11) + fi * 2.0) * 0.38 * aspect, cos(t * (0.29 + fi * 0.07) + fi * 1.4) * 0.3);
    float R = 0.22 + 0.06 * fi;
    vec2 r = p - c;
    float g = exp(-dot(r, r) / (R * R));
    dy += g * r.y * 0.9;
    lensMask += g;
  }
  float s = (p.y + dy) * 30.0;
  float line = aaLine(s, 0.035);
  float compress = clamp(abs(dFdy(s)) * uRes.y * 0.0014 - 0.6, 0.0, 1.0);
  vec3 col = mix(mix(uGold, uTeal, uv.x), uAmber, compress * 0.5);
  float alpha = line * (0.65 + 0.5 * compress + lensMask * 0.35) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'traces',
    label: 'Traces',
    hint: 'Oscilloscope traces with a phosphor glow',
    vibe: 'lines',
    opacity: 0.44,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.9 * uDrift;
  float fw = fwidth(p.y) * 1.5 + 0.0012;
  float acc = 0.0; vec3 colAcc = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i); float k = fi / 4.0;
    float env = 0.5 + 0.5 * sin(p.x * 1.4 - t * 0.35 + fi * 1.9);
    float carrier = sin(p.x * (9.0 + fi * 2.0) + t * (1.6 + fi * 0.3) + fi);
    float y = (k - 0.5) * 0.62 + 0.07 * carrier * env * env + 0.015 * (fbm(vec2(p.x * 3.0 + t * 0.4, fi * 5.0)) - 0.5);
    float d = abs(p.y - y);
    float core = 1.0 - smoothstep(0.0, fw, d);
    float glow = exp(-d * 55.0) * 0.5 + exp(-d * 14.0) * 0.12;
    float beamX = fract(t * 0.12 + k * 0.37) * (aspect + 0.4) - aspect * 0.5 - 0.2;
    float beam = exp(-pow((p.x - beamX) * 6.0, 2.0)) * exp(-d * 90.0) * 1.5;
    float w = (core + glow + beam) * (0.7 + 0.3 * env);
    acc += w; colAcc += w * mix(uTeal, uGold, k);
  }
  vec3 col = colAcc / max(acc, 1.0e-3);
  float alpha = clamp(acc * 0.75, 0.0, 1.0) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, alpha);
}`,
  },

  /* ————————————————————————————————— structure ————————————————————————————————— */
  {
    id: 'isometric',
    label: 'Isometric',
    hint: 'Three-axis lattice with light travelling across the faces',
    vibe: 'structure',
    opacity: 0.34,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.2 * uDrift;
  float freq = 11.0;
  float s1 = p.x * freq;
  float s2 = dot(p, vec2(0.5, 0.8660254)) * freq;
  float s3 = dot(p, vec2(-0.5, 0.8660254)) * freq;
  float l = max(aaLine(s1, 0.02), max(aaLine(s2, 0.02), aaLine(s3, 0.02)));
  vec2 cell = floor(vec2(s2, s3));
  float h = hash(cell);
  float lightField = fbm(p * 1.1 - vec2(t * 0.35, t * 0.12));
  float sweepPos = fract(t * 0.07) * (aspect + 1.2) - aspect * 0.5 - 0.6;
  float sweep = exp(-pow((dot(p, vec2(0.86, 0.5)) - sweepPos) * 4.0, 2.0));
  float light = smoothstep(0.42, 0.85, lightField) * 0.9 + sweep * 1.2;
  float face = step(0.7, h) * (0.5 + 0.5 * sin(t * 1.3 + h * TAU)) * light * 0.5;
  vec3 col = mix(uGold, uTeal, smoothstep(0.3, 0.8, lightField));
  col = mix(col, uAmber, sweep * 0.5);
  float alpha = (l * (0.1 + light * 0.9) + face) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'sonar',
    label: 'Sonar',
    hint: 'Warped rings spreading from an off-centre source with a slow sweep',
    vibe: 'structure',
    opacity: 0.38,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.35 * uDrift;
  vec2 c = vec2(0.28 * aspect, -0.12);
  vec2 r = p - c;
  float dist = length(r);
  float ang = atan(r.y, r.x);
  float warp = fbm(vec2(cos(ang), sin(ang)) * 2.2 + dist * 2.6 + t * 0.15) - 0.5;
  float rr = dist * (1.0 + warp * 0.22);
  float v = rr * 20.0 - t * 1.1;
  float ring = aaLine(v, 0.04);
  float fade = exp(-dist * 1.35);
  float sweepA = fract(ang / TAU - t * 0.09);
  float sweep = pow(sweepA, 10.0);
  float core = exp(-dist * dist * 160.0);
  vec3 col = mix(uTeal, uGold, smoothstep(0.2, 1.2, dist));
  col = mix(col, uAmber, sweep * 0.6);
  float alpha = (ring * fade * (0.45 + 0.9 * sweep) + core * 0.8) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'constellation',
    label: 'Constellation',
    hint: 'Drifting points linked to their neighbours',
    vibe: 'structure',
    opacity: 0.42,
    body: `
vec2 nodeAt(vec2 cell, float t){
  float h = hash(cell); float h2 = hash(cell + 3.7); float spd = 0.4 + h2 * 0.5;
  return cell + 0.5 + 0.34 * vec2(sin(t * spd + h * TAU), cos(t * spd * 0.8 + h2 * TAU));
}
float segDist(vec2 p, vec2 a, vec2 b){ vec2 ab = b - a; float h = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0); return length(p - a - ab * h); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.28 * uDrift;
  float scale = 5.5;
  vec2 g = p * scale;
  vec2 id = floor(g);
  float fw = fwidth(g.x) * 1.4 + 0.006;
  float dots = 0.0; float links = 0.0;
  vec2 pts[9];
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 n = nodeAt(id + vec2(float(i), float(j)), t);
    int k = (j + 1) * 3 + (i + 1);
    for (int m = 0; m < 9; m++) if (m == k) pts[m] = n;
    float d = length(g - n);
    dots += 1.0 - smoothstep(0.03, 0.03 + fw, d);
    dots += exp(-d * d * 40.0) * 0.25;
  }
  for (int a = 0; a < 9; a++) for (int b = 0; b < 9; b++) {
    if (b <= a) continue;
    vec2 ca = vec2(mod(float(a), 3.0), floor(float(a) / 3.0));
    vec2 cb = vec2(mod(float(b), 3.0), floor(float(b) / 3.0));
    vec2 dc = abs(ca - cb);
    if (max(dc.x, dc.y) > 1.0) continue;
    float len = length(pts[a] - pts[b]);
    float d = segDist(g, pts[a], pts[b]);
    float w = (1.0 - smoothstep(0.0, fw, d)) * smoothstep(1.55, 0.6, len);
    links += w;
  }
  vec3 col = mix(uTeal, uGold, smoothstep(0.3, 0.7, fbm(p * 1.4 + t * 0.2)));
  float alpha = (dots * 0.95 + links * 0.45) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'cells',
    label: 'Cells',
    hint: 'Organic cell walls slowly re-forming',
    vibe: 'structure',
    opacity: 0.38,
    body: `
vec2 cellPoint(vec2 n, float t){ vec2 o = hash2(n); return 0.5 + 0.42 * sin(t * 0.55 + TAU * o); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.5 * uDrift;
  vec2 q = p * 4.2 + 3.0;
  vec2 n = floor(q); vec2 f = fract(q);
  vec2 mg = vec2(0.0); vec2 mr = vec2(0.0); float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + cellPoint(n + g, t) - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  float border = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 r = g + cellPoint(n + g, t) - f;
    if (dot(mr - r, mr - r) > 1.0e-5) border = min(border, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  float fw = fwidth(border) * 1.3 + 0.008;
  float wall = 1.0 - smoothstep(0.0, fw, border);
  float halo = exp(-border * 9.0) * 0.3;
  float tint = hash(n + mg);
  float interior = smoothstep(0.75, 1.0, tint) * (0.5 + 0.5 * sin(t * 0.9 + tint * TAU)) * 0.12;
  vec3 col = mix(uTeal, uGold, tint);
  col = mix(col, uAmber, halo);
  float alpha = (wall * 0.9 + halo + interior) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },

  /* ————————————————————————————————— organic ————————————————————————————————— */
  {
    id: 'dunes',
    label: 'Dunes',
    hint: 'Shaded dune crests under a low key light',
    vibe: 'organic',
    opacity: 0.5,
    body: `
/* Large soft crests (two octaves, smooth) plus fine wind ripples riding across them. */
float height(vec2 q, float t){
  vec2 s = q * 1.7 + vec2(t * 0.08, t * 0.03);
  float h = noise(s) * 0.7 + noise(s * 2.1 + 3.0) * 0.3;
  float ridged = 1.0 - abs(2.0 * h - 1.0);
  float crest = pow(ridged, 1.4);
  float ripple = sin((q.x * 0.7 + q.y * 2.3) * 16.0 + h * 9.0 + t * 0.4) * 0.01;
  return crest + ripple;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.3 * uDrift;
  float e = 0.006;
  float h = height(p, t);
  float hx = height(p + vec2(e, 0.0), t) - height(p - vec2(e, 0.0), t);
  float hy = height(p + vec2(0.0, e), t) - height(p - vec2(0.0, e), t);
  vec3 nrm = normalize(vec3(-hx * 30.0, -hy * 30.0, 1.0));
  vec3 L = normalize(vec3(-0.6, 0.5, 0.35));
  float diff = max(dot(nrm, L), 0.0);
  float rim = pow(1.0 - max(nrm.z, 0.0), 1.3);
  vec2 s = p * 1.7 + vec2(t * 0.08, t * 0.03);
  float crest = pow(1.0 - abs(2.0 * (noise(s) * 0.7 + noise(s * 2.1 + 3.0) * 0.3) - 1.0), 14.0);
  vec3 sand = mix(uAmber, uGold, smoothstep(0.1, 0.9, h));
  vec3 col = mix(uSurface, sand, clamp(diff * 1.2, 0.0, 1.0)) + uGold * (rim * 0.4 + crest * 0.5);
  float alpha = (diff * 0.8 + rim * 0.3 + crest * 0.5) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'caustics',
    label: 'Caustics',
    hint: 'Light refracted through slow water',
    vibe: 'organic',
    opacity: 0.4,
    body: `
/* Nearest two feature distances: their gap is small on the cell walls, where light piles up. */
vec2 causticLayer(vec2 q, float t, float seed){
  vec2 id = floor(q); vec2 f = fract(q); float f1 = 8.0; float f2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash2(id + g + seed);
    o = 0.5 + 0.42 * sin(t * 0.7 + TAU * o);
    float d = length(g + o - f);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  }
  return vec2(f1, f2);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.6 * uDrift;
  vec2 q = p * 3.2;
  vec2 A = causticLayer(q + vec2(t * 0.08, t * 0.05), t, 0.0);
  vec2 B = causticLayer(q * 1.3 + vec2(-t * 0.06, t * 0.07) + 4.0, t * 1.1, 11.0);
  float webA = exp(-(A.y - A.x) * 9.0);
  float webB = exp(-(B.y - B.x) * 9.0);
  float c = webA * (0.55 + 0.7 * webB) + webB * 0.35;
  c = pow(c, 1.3);
  float depth = fbm(p * 0.9 + t * 0.05);
  vec3 col = mix(uTeal, uGold, smoothstep(0.3, 0.8, depth));
  col = mix(col, uAmber, webA * webB * 0.5);
  float alpha = c * 0.9 * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'smoke',
    label: 'Smoke',
    hint: 'Twice-warped noise — cinematic haze in brand colour',
    vibe: 'organic',
    opacity: 0.5,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.16 * uDrift;
  vec2 s = p * 1.6;
  vec2 q = vec2(fbm(s + t * 0.1), fbm(s + vec2(5.2, 1.3) + t * 0.13));
  vec2 r = vec2(fbm(s + 4.0 * q + vec2(1.7, 9.2) + 0.15 * t), fbm(s + 4.0 * q + vec2(8.3, 2.8) + 0.126 * t));
  float f = fbm(s + 4.0 * r);
  vec3 col = mix(uTeal, uGold, clamp(length(q) * 0.9, 0.0, 1.0));
  col = mix(col, uAmber, clamp(abs(r.x) * 1.2, 0.0, 1.0) * 0.6);
  col = mix(col, mix(uTeal, uGold, 0.5) * 1.15, clamp(f * f * 3.0, 0.0, 1.0) * 0.5);
  float dens = f * f * f + 0.6 * f * f + 0.5 * f;
  float alpha = clamp(dens * 1.25 - 0.08, 0.0, 1.0) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'marble',
    label: 'Marble',
    hint: 'Fine ridged veins through warped stone',
    vibe: 'organic',
    opacity: 0.42,
    body: `
/* Veins sit on the crease of each noise octave (where it crosses its midpoint). */
float veins(vec2 q, out float fine){
  float v = 0.0; fine = 0.0; float a = 1.0;
  for (int i = 0; i < 3; i++) {
    float c = 1.0 - abs(2.0 * noise(q) - 1.0);
    float line = pow(c, 14.0) + 0.6 * smoothstep(0.9, 1.0, c);
    if (i == 0) v += line * a; else fine += line * a;
    q = mat2(1.6, 1.2, -1.2, 1.6) * q + 3.7; a *= 0.55;
  }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.1 * uDrift;
  vec2 warp = vec2(fbm(p + t * 0.4), fbm(p + 3.1 - t * 0.3)) - 0.5;
  vec2 q = p * 1.6 + warp * 1.1;
  float fine;
  float vein = veins(q, fine);
  float cloud = fbm(q * 0.6 + t * 0.2);
  vec3 col = mix(uGold, uAmber, cloud);
  col = mix(col, uTeal, clamp(fine * 1.5, 0.0, 1.0) * 0.7);
  col = mix(col, mix(uGold, vec3(1.0), 0.35), clamp(vein, 0.0, 1.0) * 0.4);
  float alpha = (vein * 1.1 + fine * 0.7 + cloud * 0.1) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },

  /* ————————————————————————————————— motion ————————————————————————————————— */
  {
    id: 'tide',
    label: 'Tide',
    hint: 'Layered swells rolling across the lower frame',
    vibe: 'motion',
    opacity: 0.48,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.45 * uDrift;
  float fw = fwidth(p.y) * 1.6 + 0.0012;
  vec3 col = vec3(0.0); float alpha = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i); float k = fi / 6.0;
    float y = -0.08 - k * 0.4 + 0.05 * (1.0 - 0.3 * k) * sin(p.x * 2.0 * (1.0 + 0.25 * k) + t * (0.5 + 0.22 * k) + fi * 1.3)
            + 0.03 * (fbm(vec2(p.x * 1.6 + t * 0.3 + fi * 4.0, fi * 2.0)) - 0.5);
    float d = y - p.y;
    float inside = smoothstep(-fw, 0.0, d);
    float crest = 1.0 - smoothstep(0.0, fw, abs(d));
    float body = exp(-max(d, 0.0) * 7.0) * 0.45 + 0.08;
    vec3 c = mix(uTeal, uGold, k);
    float a = inside * body * (0.45 + 0.55 * k) + crest * 1.0;
    col = mix(col, c, clamp(a, 0.0, 1.0));
    alpha = alpha + a * (1.0 - alpha);
  }
  float horizon = exp(-pow((p.y + 0.08) * 9.0, 2.0)) * 0.14;
  col = mix(col, uAmber, horizon);
  alpha = clamp(alpha + horizon, 0.0, 1.0) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, alpha);
}`,
  },
  {
    id: 'rain',
    label: 'Rain',
    hint: 'Vertical light strands falling at two depths',
    vibe: 'motion',
    opacity: 0.42,
    body: `
float strands(vec2 p, float t, float cols, float speed, float seed, out float head){
  float x = p.x * cols;
  float id = floor(x);
  float fx = fract(x) - 0.5;
  float h = hash(vec2(id, seed)); float h2 = hash(vec2(id, seed + 2.0)); float h3 = hash(vec2(id, seed + 5.0));
  float len = mix(0.12, 0.42, h2);
  float cycle = fract(t * speed * (0.6 + h * 0.8) + h3);
  float yHead = 0.75 - cycle * 1.5;
  float dy = yHead - p.y;
  float tail = smoothstep(len, 0.0, dy) * step(0.0, dy);
  float thin = 1.0 - smoothstep(0.0, fwidth(x) * 1.3 + 0.03, abs(fx + (h3 - 0.5) * 0.5));
  head = exp(-dy * dy * 900.0) * exp(-fx * fx * 60.0) * step(0.5, h);
  return thin * tail * step(0.35, h);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.5 * uDrift;
  float headA; float headB;
  float far = strands(p, t, 80.0, 0.22, 1.0, headA);
  float near = strands(p + vec2(0.013, 0.0), t, 42.0, 0.36, 9.0, headB);
  vec3 col = mix(uTeal, uGold, smoothstep(0.2, 0.8, fbm(p * 1.2 + t * 0.1)));
  col = mix(col, uAmber, (headA + headB) * 0.6);
  float alpha = (far * 0.6 + near * 1.0 + headA * 0.8 + headB * 1.2) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  /* —————————————————————————————— second batch —————————————————————————————— */
  {
    id: 'embers',
    label: 'Embers',
    hint: 'Sparse sparks rising and cooling',
    vibe: 'motion',
    opacity: 0.55,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.35 * uDrift;
  vec3 col = uGold;
  float acc = 0.0;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float h = hash(vec2(fi, 2.3));
    float h2 = hash(vec2(fi, 8.1));
    float rise = fract(t * (0.12 + h * 0.16) + h2);
    vec2 c = vec2((h - 0.5) * 1.7 + 0.04 * sin(t + fi), -0.85 + rise * 1.7);
    float s = 0.006 + h2 * 0.012;
    float d = length(p - c);
    float spark = exp(-d * d / (s * s));
    float cool = smoothstep(0.15, 0.85, rise);
    col = mix(col, mix(uAmber, uTeal, cool), clamp(spark, 0.0, 1.0));
    acc += spark * (1.0 - cool * 0.65);
  }
  float alpha = acc * 0.85 * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'orbit',
    label: 'Orbit',
    hint: 'Three tilted ellipses, each with a traveling body',
    vibe: 'structure',
    opacity: 0.46,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.4 * uDrift;
  vec3 col = uTeal;
  float acc = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ang = 0.4 + fi * 0.62;
    float cs = cos(ang); float sn = sin(ang);
    vec2 q = mat2(cs, -sn, sn, cs) * p;
    vec2 rad = vec2(0.5 + fi * 0.14, 0.2 + fi * 0.045);
    float ring = abs(length(q / rad) - 1.0);
    float line = 1.0 - smoothstep(0.0, fwidth(ring) * 1.8 + 0.018, ring);
    float ph = t * (0.45 + fi * 0.18) + fi * 2.1;
    vec2 body = vec2(cos(ph) * rad.x, sin(ph) * rad.y);
    float glow = exp(-length(q - body) * 55.0);
    vec3 tint = mix(uTeal, mix(uGold, uAmber, fi / 2.0), fi / 2.0);
    col = mix(col, tint, clamp(line * 0.8 + glow, 0.0, 1.0));
    acc += line * 0.7 + glow * 0.9;
  }
  float alpha = acc * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'circuit',
    label: 'Circuit',
    hint: 'Right-angle traces with a pulse running the board',
    vibe: 'structure',
    opacity: 0.4,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.45 * uDrift;
  vec2 g = p * 6.5;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash(id); float h2 = hash(id + 4.2);
  float horiz = 1.0 - smoothstep(0.0, fwidth(f.y) * 1.4 + 0.012, abs(f.y));
  float vert = 1.0 - smoothstep(0.0, fwidth(f.x) * 1.4 + 0.012, abs(f.x));
  float trace = mix(vert, horiz, step(0.5, h)) * step(0.38, h2);
  float node = exp(-dot(f, f) * 90.0) * step(0.78, hash(id + 9.0));
  float pulse = smoothstep(0.22, 0.0, abs(fract(p.x * 0.45 + p.y * 0.15 - t * 0.18) - 0.5));
  vec3 col = mix(uTeal, uGold, pulse);
  col = mix(col, uAmber, node);
  float alpha = (trace * (0.6 + pulse) + node) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'horizon',
    label: 'Horizon',
    hint: 'A low glow with a handful of twinkling stars',
    vibe: 'light',
    opacity: 0.55,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.6 * uDrift;
  float glow = exp(-pow((p.y + 0.18) * 5.5, 2.0));
  float band = exp(-pow((p.y + 0.18) * 22.0, 2.0));
  float stars = 0.0;
  vec3 col = mix(uTeal, uGold, smoothstep(-0.2, 0.35, p.y));
  for (int i = 0; i < 28; i++) {
    float fi = float(i);
    vec2 s = hash2(vec2(fi, 1.7));
    s = vec2((s.x - 0.5) * 1.75, s.y * 0.72 + 0.02);
    float tw = 0.35 + 0.65 * (0.5 + 0.5 * sin(t * (0.8 + s.x) + fi));
    float spark = (exp(-length(p - s) * 70.0) + exp(-length(p - s) * 18.0) * 0.35) * tw;
    stars += spark;
    col = mix(col, mix(uGold, uAmber, hash(vec2(fi, 3.0))), clamp(spark, 0.0, 1.0));
  }
  col = mix(col, uAmber, band);
  float alpha = (glow * 0.55 + band * 0.7 + stars * 1.1) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'shaft',
    label: 'Shaft',
    hint: 'One diagonal shaft of light with drifting motes',
    vibe: 'light',
    opacity: 0.5,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.25 * uDrift;
  float axis = p.x * 0.65 + p.y + 0.05 + sin(t * 0.35) * 0.06;
  float beam = exp(-axis * axis * 10.0);
  float core = exp(-axis * axis * 80.0);
  float motes = 0.0;
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float h = hash(vec2(fi, 5.5));
    float along = fract(h * 1.7 + t * (0.08 + h * 0.05));
    vec2 c = vec2((along - 0.5) * 1.5, (0.5 - along) * 0.95 + (h - 0.5) * 0.08);
    motes += exp(-length(p - c) * 90.0);
  }
  vec3 col = mix(uTeal, uGold, smoothstep(-0.4, 0.5, p.x));
  col = mix(col, uAmber, clamp(core + motes, 0.0, 1.0));
  float alpha = (beam * 0.55 + core * 0.45 + motes * 0.8) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'eclipse',
    label: 'Eclipse',
    hint: 'A slow corona drifting off centre',
    vibe: 'light',
    opacity: 0.48,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.2 * uDrift;
  vec2 c = vec2(0.22 * sin(t), 0.1 * cos(t * 0.8));
  float r = length(p - c);
  float n = fbm((p - c) * 2.4 + vec2(t, -t * 0.6));
  float corona = exp(-pow((r - 0.32) * 7.0, 2.0)) * (0.45 + 0.7 * n);
  float ring = exp(-pow((r - 0.32) * 26.0, 2.0));
  float flare = exp(-pow((r - 0.32) * 3.2, 2.0)) * smoothstep(0.2, 0.85, n);
  vec3 col = mix(uGold, uTeal, n);
  col = mix(col, uAmber, ring);
  float alpha = (corona * 0.7 + ring * 0.85 + flare * 0.35) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'tunnel',
    label: 'Tunnel',
    hint: 'A square tunnel drifting forward',
    vibe: 'structure',
    opacity: 0.4,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.35 * uDrift;
  float r = max(length(p), 0.045);
  float z = 0.55 / r + t;
  float ang = atan(p.y, p.x);
  float spokes = abs(fract(ang / TAU * 10.0) - 0.5);
  float rings = abs(fract(z) - 0.5);
  float fwS = fwidth(ang / TAU * 10.0) * 1.2 + 0.02;
  float fwR = fwidth(z) * 1.1 + 0.02;
  float line = max(1.0 - smoothstep(0.0, fwS, spokes), 1.0 - smoothstep(0.0, fwR, rings));
  float fade = smoothstep(0.04, 0.22, r) * (1.0 - smoothstep(0.85, 1.25, r));
  vec3 col = mix(uTeal, uGold, fract(z));
  float alpha = line * fade * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'meters',
    label: 'Meters',
    hint: 'A row of level meters breathing along the bottom',
    vibe: 'motion',
    opacity: 0.5,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.9 * uDrift;
  float x = (p.x + 0.9) * 14.0;
  float id = floor(x);
  float fx = abs(fract(x) - 0.5);
  float h = hash(vec2(id, 1.2));
  float level = 0.06 + 0.28 * pow(0.5 + 0.5 * sin(t * (0.8 + h) + id * 0.55), 1.4);
  float y0 = -0.62;
  float inBar = step(y0, p.y) * step(p.y, y0 + level);
  float thin = 1.0 - smoothstep(0.16, 0.34, fx);
  float cap = exp(-pow((p.y - (y0 + level)) * 40.0, 2.0)) * thin;
  vec3 col = mix(uTeal, uAmber, clamp((p.y - y0) / 0.3, 0.0, 1.0));
  float alpha = (inBar * thin * 0.75 + cap * 0.9) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'hex',
    label: 'Hex',
    hint: 'A hexagonal lattice with a wandering light',
    vibe: 'structure',
    opacity: 0.38,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.3 * uDrift;
  vec2 cell = p * 7.0;
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(cell, r) - h;
  vec2 b = mod(cell - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 hg = abs(g);
  float edge = max(hg.x, hg.x * 0.5 + hg.y * 0.8660254);
  float line = 1.0 - smoothstep(0.02, 0.02 + fwidth(edge) * 2.4, 0.5 - edge);
  vec2 lamp = vec2(sin(t) * 0.45, cos(t * 0.73) * 0.28);
  float near = exp(-length(p - lamp) * 2.4);
  vec3 col = mix(uTeal, uGold, near);
  float alpha = line * (0.28 + near * 1.1) * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'spiral',
    label: 'Spiral',
    hint: 'A single arm unwinding from the centre',
    vibe: 'lines',
    opacity: 0.42,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.15 * uDrift;
  float rad = length(p);
  float ang = atan(p.y, p.x);
  float s = ang / TAU + rad * 0.55 - t;
  float line = aaLine(s, 0.14);
  float glow = exp(-abs(fract(s) - 0.5) * 7.0);
  float fade = smoothstep(0.02, 0.12, rad) * (1.0 - smoothstep(0.75, 1.15, rad));
  vec3 col = mix(uGold, uTeal, smoothstep(0.0, 0.8, rad));
  float alpha = (line * 0.85 + glow * 0.22) * fade * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'frost',
    label: 'Frost',
    hint: 'A few crystal branches growing up from the edge',
    vibe: 'organic',
    opacity: 0.48,
    body: `
float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a; vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.15 * uDrift;
  float acc = 0.0;
  vec3 col = uTeal;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float h = hash(vec2(fi, 1.4));
    float grow = smoothstep(0.0, 1.0, fract(t * 0.35 + h));
    vec2 a = vec2((h - 0.5) * 1.55, -0.78);
    vec2 b = a + vec2((hash(vec2(fi, 2.2)) - 0.5) * 0.28, 0.55 * grow);
    float d = sdSeg(p, a, b);
    float trunk = 1.0 - smoothstep(0.0, fwidth(d) * 1.5 + 0.004, d);
    acc += trunk;
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      vec2 fork = mix(a, b, 0.45 + fk * 0.3);
      vec2 tip = fork + vec2((hash(vec2(fi, 6.0 + fk)) - 0.5) * 0.36, 0.22 * grow);
      float db = sdSeg(p, fork, tip);
      float branch = 1.0 - smoothstep(0.0, fwidth(db) * 1.5 + 0.003, db);
      acc += branch * 0.8;
    }
    col = mix(col, mix(uTeal, uGold, h), clamp(trunk, 0.0, 1.0));
  }
  float alpha = acc * 0.85 * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
  {
    id: 'braid',
    label: 'Braid',
    hint: 'Three thick ribbons weaving through each other',
    vibe: 'lines',
    opacity: 0.46,
    body: `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.35 * uDrift;
  vec3 col = uTeal;
  float acc = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = sin(p.x * 2.1 + t * (0.55 + fi * 0.12) + fi * 2.094) * 0.16 + (fi - 1.0) * 0.02;
    float d = abs(p.y - y);
    float w = 0.012 + 0.008 * sin(p.x * 5.0 + fi + t);
    float band = 1.0 - smoothstep(w, w + fwidth(p.y) * 1.8, d);
    float core = exp(-d * d * 1800.0);
    vec3 tint = mix(uTeal, mix(uGold, uAmber, fi / 2.0), fi / 2.0);
    col = mix(col, tint, clamp(band, 0.0, 1.0));
    acc += band * 0.75 + core * 0.35;
  }
  float alpha = acc * vignette(p) * contentDim(uv) * uOpacity * uEnv;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
  },
]);

/** The fields a review already accepted. Order here is the order they join ATMOSPHERE_IDS. */
const PROMOTED_IDS = [
  'contour', 'signal', 'halftone', 'iridescent', 'silk', 'ridgelines', 'interference', 'warpstripes',
  'bend', 'traces', 'isometric', 'sonar', 'constellation', 'cells', 'dunes', 'caustics', 'smoke',
  'marble', 'tide', 'rain',
  'embers', 'orbit', 'circuit', 'horizon', 'shaft', 'eclipse', 'tunnel', 'meters', 'hex', 'spiral',
  'frost', 'braid',
];

export const LAB_FIELD_IDS = Object.freeze(LAB_FIELDS.map((f) => f.id));

export const PROMOTED_FIELDS = Object.freeze(PROMOTED_IDS.map((id) => {
  const field = LAB_FIELDS.find((f) => f.id === id);
  if (!field) throw new Error(`Promoted atmosphere "${id}" is missing from the lab`);
  return field;
}));

/** Full fragment shader for a candidate (preamble + lab helpers + body). */
export function labShaderSource(id) {
  const field = LAB_FIELDS.find((f) => f.id === id);
  if (!field) throw new Error(`Unknown lab atmosphere "${id}"`);
  return GLSL_PREAMBLE + GLSL_LAB_COMMON + field.body;
}
