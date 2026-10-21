/**
 * Export presets cut from the finished master (picture + mixed audio): social sizes on a brand
 * background, a light 720p for email and chat, and a GIF teaser. Each video variant is one x264
 * generation from the CRF 12 master, through the same floor and BT.709 tagging as the master.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { frameAssets, frameGraph } from './camera.mjs';
import { assertX264Args, BT709_PARAMS, BT709_TAGS, lossyX264, QUALITY } from './encode.mjs';
import { duration, ffmpegProgress, mmss, run } from './media.mjs';

const even = (v) => Math.round(v / 2) * 2;

export const EXPORT_PRESETS = Object.freeze({
  square: { label: 'Square 1:1', hint: 'LinkedIn, X, feeds', width: 1080, height: 1080, kind: 'social' },
  vertical: { label: 'Vertical 9:16', hint: 'Reels, Shorts', width: 1080, height: 1920, kind: 'social' },
  lite: { label: 'Light 720p', hint: 'Email, Slack, docs', width: 1280, height: 720, kind: 'scale' },
  gif: { label: 'GIF teaser', hint: '10 s loop, READMEs', width: 960, kind: 'gif' },
});

export function exportsDir(video) {
  return join(video.out, 'exports');
}

export function exportFile(video, id) {
  return join(exportsDir(video), `${video.slug}-${id}.${id === 'gif' ? 'gif' : 'mp4'}`);
}

/** Window placement for a 16:9 master on a social canvas. */
export function socialGeometry({ width, height }) {
  const w = even(width - 80);
  const h = even((w * 9) / 16);
  return { w, h, x: 2 * Math.floor((width - w) / 4), y: 2 * Math.floor((height - h) / 4), radius: 26 };
}

function readMeta(video) {
  const path = join(video.out, 'produce-meta.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

/** A teaser starts on the first live chapter, after the open, never on black. */
export function teaserWindow(meta, total) {
  const live = (meta.chapters || []).find((c) => c.start > 2 && !/intro|summary|close/i.test(c.title || ''));
  const start = Math.max(0, Math.min(live ? live.start + 0.8 : total * 0.15, total - 4));
  return { start, dur: Math.max(2, Math.min(10, total - start - 0.5)) };
}

export function variantArgs(video, id, master) {
  const preset = EXPORT_PRESETS[id];
  const out = exportFile(video, id);
  const head = ['-hide_banner', '-loglevel', 'error', '-y', '-i', master];
  const tail = [
    ...lossyX264({ ...QUALITY.delivery, crf: QUALITY.variant.crf }),
    '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...BT709_TAGS,
    '-map', '0:a?', '-c:a', 'copy', '-movflags', '+faststart', out,
  ];
  if (preset.kind === 'scale') {
    const vf = `scale=${preset.width}:${preset.height}:flags=lanczos+accurate_rnd+full_chroma_int:in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv,format=yuv420p,${BT709_PARAMS}`;
    return { out, args: [...head, '-filter_complex', `[0:v]${vf}[v]`, '-map', '[v]', ...tail] };
  }
  const { width, height } = preset;
  const geo = socialGeometry({ width, height });
  const assets = frameAssets(video, { width, height, background: 'brand', geo });
  const total = duration(master);
  const loop = ['-loop', '1', '-framerate', '30', '-t', total.toFixed(3), '-i'];
  const graph = frameGraph({ src: '[0:v]', out: '[v]', bgIdx: 1, maskIdx: 2, geo, width, height });
  return { out, args: [...head, ...loop, assets.bg, ...loop, assets.mask, '-filter_complex', graph, '-map', '[v]', ...tail] };
}

function gifExport(video, master) {
  const out = exportFile(video, 'gif');
  const total = duration(master);
  const { start, dur } = teaserWindow(readMeta(video), total);
  const w = EXPORT_PRESETS.gif.width;
  run(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', start.toFixed(2), '-t', dur.toFixed(2), '-i', master,
      '-filter_complex',
      `[0:v]fps=12,scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
      '-loop', '0', out,
    ],
    'gif teaser'
  );
  return { out, start, dur };
}

/** Build the requested presets. Returns [{ id, file, sizeMB }]. */
export async function buildExports(video, ids = Object.keys(EXPORT_PRESETS), { onProgress } = {}) {
  const master = join(video.out, `${video.slug}.mp4`);
  if (!existsSync(master)) throw new Error(`No master yet. Produce ${video.slug} first.`);
  const unknown = ids.filter((id) => !EXPORT_PRESETS[id]);
  if (unknown.length) throw new Error(`Unknown export preset: ${unknown.join(', ')}. Use ${Object.keys(EXPORT_PRESETS).join(', ')}.`);
  mkdirSync(exportsDir(video), { recursive: true });
  const total = duration(master);
  const done = [];
  for (const id of ids) {
    const preset = EXPORT_PRESETS[id];
    console.log(`» export · ${preset.label}`);
    if (preset.kind === 'gif') {
      const gif = gifExport(video, master);
      done.push({ id, file: gif.out });
    } else {
      const { out, args } = variantArgs(video, id, master);
      assertX264Args('variant', args);
      await ffmpegProgress(args, {
        label: `${id} export`,
        totalSec: total,
        onProgress: (p) => {
          onProgress?.(id, p);
          console.log(`» export · ${preset.label} · ${Math.min(99, Math.floor(p.fraction * 100))}% of ${mmss(total)}`);
        },
      });
      done.push({ id, file: out });
    }
    const last = done.at(-1);
    last.sizeMB = Number((statSync(last.file).size / 1024 / 1024).toFixed(1));
    console.log(`✓ ${last.file} (${last.sizeMB} MB)`);
  }
  return done;
}

/** Existing export files, for Studio and the handoff. */
export function listExports(video) {
  return Object.entries(EXPORT_PRESETS)
    .map(([id, preset]) => {
      const file = exportFile(video, id);
      if (!existsSync(file)) return null;
      const st = statSync(file);
      return { id, label: preset.label, file, sizeMB: Number((st.size / 1024 / 1024).toFixed(1)), mtime: st.mtimeMs };
    })
    .filter(Boolean);
}
