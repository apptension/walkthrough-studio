/**
 * Magnifier lens, rendered in post from the real frames (pixel-perfect, no DOM cloning).
 * A `magnify` mark from ctx.magnify() carries the element's rect in live-frame pixels; the lens is
 * a circular loupe centred on it, drawn as a thick convex glass (see studio/lensGlass.js): the
 * magnification peaks at the centre and eases off toward a dark bevel band, red/blue fringe a
 * touch at the edge, a specular blob and a Fresnel crescent sit on the surface, and a lit metal
 * rim holds it. It scales and swells into place with the video's motion curve, travels with the
 * pointer on a minimum-jerk path (sub-pixel, no stepping), and leaves faster than it came.
 *
 * Everything is one ffmpeg `geq` over an oversized working canvas so the glass can sample past
 * its own diameter; the canvas is then cropped back to the loupe plus shadow room.
 */
import { BT709_SCALE_OPTS } from './encode.mjs';
import { curveOf, minJerkExpr, unitExpr } from '../studio/easing.js';
import { GLASS, LENS_TIMING, glassCanvas, lensTiming, rimWidth } from '../studio/lensGlass.js';

export { LENS_TIMING, lensTiming };

/** Shadow room around the rim (may hang off the frame with the loupe). */
export const LENS_PAD = 36;
const PAD = LENS_PAD;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const even = (v) => Math.round(v / 2) * 2;
const r3 = (v) => Number(Number(v).toFixed(3));
const n4 = (v) => Number(Number(v).toFixed(4));

/**
 * Top-left of the S×S loupe canvas, centred on the target.
 * Near an edge the circle may sit partly off-screen — pinning it into the frame
 * pulled the glass off the target and looked wrong. Overlay/canvas clip the overhang.
 * `width`/`height` kept for call-site compatibility.
 */
export function loupeOrigin(cx, cy, S, _width, _height) {
  return {
    ox: Math.round(cx - S / 2),
    oy: Math.round(cy - S / 2),
  };
}

/**
 * Piecewise path value: holds at a point, then travels to the next on a minimum-jerk profile
 * between the two `at` times — the same bell the pointer glide draws, so loupe and pointer arrive
 * together. `timeVar` is `t` (overlay, live clock) or `T` (geq, lens-local clock). Uses st(2).
 */
function pathExpr(points, key, timeVar, timeOffset = 0) {
  if (points.length < 2) return String(points[0][key]);
  let out = String(points.at(-1)[key]);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i];
    const b = points[i + 1];
    const from = a.at + timeOffset;
    const to = b.at + timeOffset;
    const dt = Math.max(0.001, to - from);
    const value =
      a[key] === b[key]
        ? String(a[key])
        : `(st(2,${unitExpr(timeVar, from, dt)});${a[key]}+${r3(b[key] - a[key])}*${minJerkExpr('ld(2)')})`;
    out = `if(lt(${timeVar},${to.toFixed(3)}),${value},${out})`;
  }
  return out;
}

/** Geometry for one lens, including pointer-follow path expressions (render and overlay clocks). */
export function lensGeometry(mark, { width, height }) {
  const path = (mark.path?.length ? mark.path : [{ at: 0, rect: mark.rect }]).map((point) => ({
    at: Number(point.at) || 0,
    rect: point.rect,
  }));
  const size = Math.max(24, ...path.map((point) => Math.max(point.rect.w, point.rect.h)));
  let zoom = mark.zoom ?? clamp(260 / size, 1.5, 2.4);
  let diameter = clamp(size * zoom + 90, 300, 540);
  if (size * zoom + 90 > 540) zoom = Math.max(1.2, (540 - 90) / size);
  diameter = even(diameter);
  const { S, W, over } = glassCanvas(diameter, PAD);
  // The working canvas W holds the crop at full magnification; the crop is even, so the exact
  // magnification differs from the nominal `zoom` by well under 1% (Studio sizing uses the nominal).
  const cropW = even(W / zoom);
  const zoomExact = W / cropW;
  // The source is padded by `pad` (edge pixels smeared outward) so the crop never has to clamp:
  // a target at the frame border still sits dead centre in the loupe.
  const pad = cropW;
  const positions = path.map(({ at, rect }) => {
    const cx = clamp(rect.x + rect.w / 2, 0, width);
    const cy = clamp(rect.y + rect.h / 2, 0, height);
    return {
      at,
      cropX: r3(cx - cropW / 2 + pad),
      cropY: r3(cy - cropW / 2 + pad),
      ox: r3(cx - S / 2),
      oy: r3(cy - S / 2),
    };
  });
  const moving = positions.length > 1;
  const first = positions[0];
  // crop/overlay only take whole (and for yuv420 overlay, even) pixels. The exact position is kept
  // and the remainder is folded back into the glass inside the canvas, so a travelling loupe and
  // its contents move in sub-pixel steps instead of hopping 1–2 px per frame.
  const evenFloor = (v) => 2 * Math.floor(v / 2);
  const centre = over + S / 2;
  let geo;
  if (!moving) {
    geo = {
      cropX: String(Math.round(first.cropX)),
      cropY: String(Math.round(first.cropY)),
      ox: String(evenFloor(first.ox)),
      oy: String(evenFloor(first.oy)),
      // Glass centre inside the W canvas and where the magnified target centre landed (sub-pixel).
      cxs: n4(centre + first.ox - evenFloor(first.ox)),
      cys: n4(centre + first.oy - evenFloor(first.oy)),
      axs: n4(W / 2 + (first.cropX - Math.round(first.cropX)) * zoomExact),
      ays: n4(W / 2 + (first.cropY - Math.round(first.cropY)) * zoomExact),
    };
  } else {
    const cx = pathExpr(positions, 'cropX', 'T');
    const cy = pathExpr(positions, 'cropY', 'T');
    const ox = pathExpr(positions, 'ox', 'T');
    const oy = pathExpr(positions, 'oy', 'T');
    geo = {
      cropX: `round(${pathExpr(positions, 'cropX', 't')})`,
      cropY: `round(${pathExpr(positions, 'cropY', 't')})`,
      ox: `2*floor((${pathExpr(positions, 'ox', 't', mark.t)})/2)`,
      oy: `2*floor((${pathExpr(positions, 'oy', 't', mark.t)})/2)`,
      cxs: `(${centre}+(${ox})-2*floor((${ox})/2))`,
      cys: `(${centre}+(${oy})-2*floor((${oy})/2))`,
      axs: `(${W / 2}+((${cx})-round(${cx}))*${n4(zoomExact)})`,
      ays: `(${W / 2}+((${cy})-round(${cy}))*${n4(zoomExact)})`,
    };
  }
  return { zoom, zoomExact, diameter, S, W, over, cropW, pad, moving, ...geo };
}

/**
 * Graph for one lens input (already trimmed to the mark with -ss/-t) → `[lensN]` with alpha,
 * timestamps shifted to the mark's time on the live timeline.
 *
 * geq registers — colour: 0 dist · 1 radius · 2 path temp · 3 glass cx · 4 glass cy ·
 * 6 sample origin x · 7 sample origin y · 8 d (dist/radius) · 9 sampling factor.
 * Alpha: the same, plus 5 opacity. 3/4/6/7 first hold the entrance state, then are reused.
 */
export function lensGraph(inputIdx, n, mark, geo, rimHex = '#F6AA1E', timing = LENS_TIMING) {
  const { S, W, over, cropW, cropX, cropY, diameter, pad = 0, cxs, cys, axs, ays } = geo;
  const G = GLASS;
  const dur = mark.dur;
  const R0 = diameter / 2;
  const [rr, gg, bb] = [1, 3, 5].map((i) => parseInt(rimHex.slice(i, i + 2), 16));
  const curve = curveOf(timing.curve);
  const IN = Math.max(0.05, timing.in);
  const OUT = Math.max(0.05, timing.out);
  const bevel = `clip((ld(8)-${G.bevelFrom})/${n4(1 - G.bevelFrom)},0,1)`;

  // Entrance: eased open (3), accelerating close (4) → scale (6), swell (7); then radius (1).
  const state =
    `st(3,${curve.expr(unitExpr('T', 0, IN))});` +
    `st(4,1-pow(1-clip((${dur.toFixed(3)}-T)/${OUT.toFixed(3)},0,1),3));` +
    `st(6,min(${G.scaleIn}+${n4(1 - G.scaleIn)}*ld(3),${G.scaleOut}+${n4(1 - G.scaleOut)}*ld(4)));` +
    `st(7,min(${G.swellIn}+${n4(1 - G.swellIn)}*ld(3),${G.swellOut}+${n4(1 - G.swellOut)}*ld(4)));` +
    `st(1,${R0}*ld(6));`;
  const alphaState =
    `st(5,min(1-pow(1-clip(T/${(IN * G.fadeIn).toFixed(3)},0,1),2),` +
    `1-pow(clip((T-${(dur - OUT * G.fadeOut).toFixed(3)})/${(OUT * G.fadeOut).toFixed(3)},0,1),2)));`;
  // Where the glass sits in the canvas (sub-pixel) and how far each pixel is from its centre.
  const place = `st(3,${cxs});st(4,${cys});st(0,hypot(X-ld(3),Y-ld(4)));st(8,ld(0)/ld(1));`;
  // Optics: sampling factor (1 = full zoom at the centre) and where the magnified target landed.
  const optics =
    `st(9,(1+${G.bulge}*pow(ld(8),4)+${G.bevel}*pow(${bevel},2))/ld(7));` + `st(6,${axs});st(7,${ays});`;

  const RIM = n4(rimWidth(diameter));
  // Direction of each pixel from the centre along the light axis (top-left = −1 … bottom-right = +1).
  const along = `(((X-ld(3))+(Y-ld(4)))/(ld(0)+0.001)/1.4142)`;
  const shade = `(1-${G.vignette}*pow(ld(8),5))*(1-${G.bevelShade}*pow(${bevel},1.5))`;
  const light =
    `${G.specular}*exp(-(pow(X-ld(3)+0.5*ld(1),2)+pow(Y-ld(4)+0.52*ld(1),2))/(2*pow(0.12*ld(1),2)))` +
    `+${G.edgeLight}*clip(1-abs(ld(8)-0.955)/0.03,0,1)*clip(-${along},0,1)` +
    `+${G.topLight}*pow(clip((ld(4)-Y)/ld(1),0,1),1.5)*(1-ld(8)*ld(8))` +
    `+${G.crescent}*pow(clip((ld(8)-0.86)/0.14,0,1),2)*clip(${along},0,1)`;
  const rimMix = `clip(ld(0)-(ld(1)-${RIM})+0.5,0,1)`;
  // Metal: lit from the top, a bright bevel line on the inside, a dark line on the outside.
  const rimOf = (c) =>
    `((${c}*(${n4(1 - G.rimLight / 2)}+${G.rimLight}*clip(0.5+(ld(4)-Y)/(2*ld(1)),0,1))` +
    `+60*clip(1-abs(ld(0)-(ld(1)-${RIM}))*0.9,0,1))*(1-0.35*clip(ld(0)-(ld(1)-1.2),0,1)))`;
  const sample = (src, ca) => {
    const k = ca ? `*(1${ca > 0 ? '+' : '-'}${Math.abs(ca)}*ld(8)*ld(8))` : '';
    return `${src}(ld(6)+(X-ld(3))*ld(9)${k},ld(7)+(Y-ld(4))*ld(9)${k})`;
  };
  const channel = (src, rim, ca) =>
    `'${state}${place}${optics}` +
    `if(lt(ld(0),ld(1)+0.5),clip((${sample(src, ca)}*${shade}+${light})*(1-${rimMix})+${rimOf(rim)}*${rimMix},0,255),0)'`;
  const alpha =
    `'${state}${alphaState}${place}` +
    `st(2,clip(ld(1)-ld(0)+0.5,0,1));` +
    `(255*ld(2)+(1-ld(2))*${G.shadow}*pow(clip(1-(hypot(X-ld(3),Y-ld(4)-${G.shadowDrop}*ld(1))-ld(1))/${PAD},0,1),2.2))*ld(5)'`;

  const extend = pad
    ? `pad=w=iw+${2 * pad}:h=ih+${2 * pad}:x=${pad}:y=${pad},` +
      `fillborders=left=${pad}:right=${pad}:top=${pad}:bottom=${pad}:mode=smear,`
    : '';
  return (
    `[${inputIdx}:v]fps=30,setpts=PTS-STARTPTS,format=rgba,${extend}crop=${cropW}:${cropW}:x='${cropX}':y='${cropY}',` +
    `scale=${W}:${W}:flags=lanczos,` +
    `geq=r=${channel('r', rr, G.aberration)}:g=${channel('g', gg, 0)}:b=${channel('b', bb, -G.aberration)}:a=${alpha},` +
    `crop=${S}:${S}:${over}:${over},` +
    `scale=${BT709_SCALE_OPTS},format=yuva420p,` +
    `setpts=PTS+${mark.t.toFixed(3)}/TB[lens${n}]`
  );
}
