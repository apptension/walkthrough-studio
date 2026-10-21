/**
 * Magnifier lens, rendered in post from the real frames (pixel-perfect, no DOM cloning).
 * A `magnify` mark from ctx.magnify() carries the element's rect in live-frame pixels; the lens is
 * a circular loupe centred on it: an iris that opens with an expo ease, a gold rim, a soft glass
 * sheen and a drop shadow, closing again before the mark's time is up.
 */
import { BT709_SCALE_OPTS } from './encode.mjs';

const IN = 0.5; // iris open
const OUT = 0.38; // iris close
/** Shadow room around the rim (may hang off the frame with the loupe). */
export const LENS_PAD = 36;
const PAD = LENS_PAD;
const RIM = 3.5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const even = (v) => Math.round(v / 2) * 2;

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

function expression(points, key, timeOffset = 0) {
  if (points.length < 2) return String(points[0][key]);
  let out = String(points.at(-1)[key]);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i];
    const b = points[i + 1];
    const from = a.at + timeOffset;
    const to = b.at + timeOffset;
    const dt = Math.max(0.001, to - from);
    const value = `${a[key]}+(${b[key]}-${a[key]})*clip((t-${from.toFixed(3)})/${dt.toFixed(3)},0,1)`;
    out = `if(lt(t,${to.toFixed(3)}),${value},${out})`;
  }
  return out;
}

/** Geometry for one lens, including optional pointer-follow path expressions. */
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
  const S = diameter + 2 * PAD;
  const cropW = even(S / zoom);
  // The source is padded by `pad` (edge pixels smeared outward) so the crop never has to clamp:
  // a target at the frame border still sits dead centre in the loupe.
  const pad = cropW;
  const positions = path.map(({ at, rect }) => {
    const cx = clamp(rect.x + rect.w / 2, 0, width);
    const cy = clamp(rect.y + rect.h / 2, 0, height);
    const { ox, oy } = loupeOrigin(cx, cy, S, width, height);
    return {
      at,
      cropX: Math.round(cx - cropW / 2 + pad),
      cropY: Math.round(cy - cropW / 2 + pad),
      ox,
      oy,
    };
  });
  return {
    zoom,
    diameter,
    S,
    cropW,
    pad,
    cropX: expression(positions, 'cropX'),
    cropY: expression(positions, 'cropY'),
    ox: expression(positions, 'ox', mark.t),
    oy: expression(positions, 'oy', mark.t),
    moving: positions.length > 1,
  };
}

/**
 * Graph for one lens input (already trimmed to the mark with -ss/-t) → `[lensN]` with alpha,
 * timestamps shifted to the mark's time on the live timeline.
 */
export function lensGraph(inputIdx, n, mark, geo, rimHex = '#F6AA1E') {
  const { S, cropW, cropX, cropY, diameter, pad = 0 } = geo;
  const extend = pad
    ? `pad=w=iw+${2 * pad}:h=ih+${2 * pad}:x=${pad}:y=${pad},` +
      `fillborders=left=${pad}:right=${pad}:top=${pad}:bottom=${pad}:mode=smear,`
    : '';
  const dur = mark.dur;
  const R0 = diameter / 2;
  const [rr, gg, bb] = [1, 3, 5].map((i) => parseInt(rimHex.slice(i, i + 2), 16));
  const c = S / 2;
  // st(0)=distance from centre, st(1)=radius now, st(2)=rim mix, st(3)=open amount
  const pre =
    `st(3,min(1-pow(2,-10*clip(T/${IN},0,1)),1-pow(1-clip((${dur}-T)/${OUT},0,1),3)));` +
    `st(0,hypot(X-${c},Y-${c}));st(1,${R0}*(0.25+0.75*ld(3)));` +
    `st(2,clip(ld(0)-(ld(1)-${RIM})+0.5,0,1));`;
  const sheen = `if(lt(ld(0),ld(1)),26*clip(1-(Y-(${c}-ld(1)))/(ld(1)*0.7),0,1)*clip(1-abs(X-${c})/ld(1),0,1),0)`;
  const ch = (src, rim) => `'${pre}if(lt(ld(0),ld(1)),clip(${src}(X,Y)*(1-ld(2))+${rim}*ld(2)+${sheen},0,255),0)'`;
  const alpha =
    `'${pre}st(4,clip(ld(1)-ld(0)+0.5,0,1));` +
    `if(lt(ld(0),ld(1)),(255*ld(4)+(1-ld(4))*130*ld(3))*clip(ld(3)*3,0,1),` +
    `130*ld(3)*pow(clip(1-(ld(0)-ld(1))/${PAD},0,1),2.2))'`;
  return (
    `[${inputIdx}:v]fps=30,setpts=PTS-STARTPTS,${extend}crop=${cropW}:${cropW}:x='${cropX}':y='${cropY}',` +
    `scale=${S}:${S}:flags=lanczos,format=rgba,` +
    `geq=r=${ch('r', rr)}:g=${ch('g', gg)}:b=${ch('b', bb)}:a=${alpha},` +
    `scale=${BT709_SCALE_OPTS},format=yuva420p,` +
    `setpts=PTS+${mark.t.toFixed(3)}/TB[lens${n}]`
  );
}
