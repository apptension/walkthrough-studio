/**
 * Pre-rendered magnifier glass.
 *
 * The optics are a `geq` expression evaluated per pixel per channel, which costs tens of
 * seconds for one lens — on a take with seven of them it was the whole cost of the clean pass,
 * paid again on every produce. The glass only depends on the take and the mark, so each one is
 * rendered once into a lossless RGBA clip, cached by content, and overlaid from then on.
 *
 * Lenses are independent, so they render side by side instead of queueing inside one graph.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { lensOpticsChain } from './lens.mjs';

/** Bump when the bake pipeline changes, so cached glass is re-rendered. */
const LENS_BAKE_PIPELINE = 1;

/** One ffmpeg per lens; geq is CPU-bound, so leave room for the machine. */
const LENS_JOBS = Math.max(
  1,
  Math.min(8, Number(process.env.WALKTHROUGH_LENS_JOBS) || Math.max(1, Math.floor((cpus()?.length || 4) / 2)))
);

const keyPath = (file) => file.replace(/\.mov$/, '.json');

/** Content key for one baked lens: the take it samples and everything that shapes the glass. */
export function lensBakeKey({ take, mark, geo, rimHex, timing }) {
  return createHash('sha1')
    .update(
      JSON.stringify({
        pipeline: LENS_BAKE_PIPELINE,
        take,
        t: Number(mark.t.toFixed(3)),
        dur: Number(mark.dur.toFixed(3)),
        optics: lensOpticsChain(mark, geo, rimHex, timing),
      })
    )
    .digest('hex')
    .slice(0, 16);
}

export function lensBakeName(mark, index) {
  return `${String(index).padStart(2, '0')}-lens-t${mark.t.toFixed(2)}-d${mark.dur.toFixed(2)}.mov`;
}

/** Lossless RGBA, so the baked glass is the same picture the direct graph would have made. */
export function lensBakeArgs(take, mark, geo, rimHex, timing, outPath) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', mark.t.toFixed(3), '-t', mark.dur.toFixed(3), '-i', take,
    '-filter_complex', `[0:v]${lensOpticsChain(mark, geo, rimHex, timing)}[glass]`,
    '-map', '[glass]',
    '-c:v', 'png', '-pix_fmt', 'rgba', '-an',
    outPath,
  ];
}

/** The glass must stay lossless with real alpha, or the rim and shadow band. */
export function assertLensBakeArgs(args) {
  const flag = (name) => args[args.lastIndexOf(name) + 1];
  if (flag('-c:v') !== 'png') throw new Error('lens bake: the glass must be stored lossless (-c:v png)');
  if (flag('-pix_fmt') !== 'rgba') throw new Error('lens bake: the glass needs real alpha (-pix_fmt rgba)');
}

function render(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => {
      err = (err + d).slice(-2000);
    });
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`lens bake failed: ${err.split('\n').filter(Boolean).pop() || code}`))
    );
  });
}

/**
 * Render every lens that is not already cached, in parallel.
 *
 * @param {object} video
 * @param {string} take the recording the glass samples
 * @param {{mark: object, geo: object}[]} lenses
 * @returns {Promise<{files: string[], stamp: string|null, rendered: number}>}
 */
export async function prepareLensBakes(video, take, lenses, { rimHex = '#F6AA1E', timing, force = false } = {}) {
  if (!lenses?.length) return { files: [], stamp: null, rendered: 0 };
  const dir = join(video.out, 'overlays', 'lens');
  mkdirSync(dir, { recursive: true });
  const st = statSync(take);
  const takeId = `${st.size}:${st.mtimeMs}`;
  const plans = lenses.map(({ mark, geo }, i) => {
    const key = lensBakeKey({ take: takeId, mark, geo, rimHex, timing });
    return { mark, geo, key, file: join(dir, lensBakeName(mark, i)) };
  });

  const fresh = (plan) => {
    if (!existsSync(plan.file)) return false;
    try {
      return JSON.parse(readFileSync(keyPath(plan.file), 'utf8')).key === plan.key;
    } catch {
      return false;
    }
  };
  const queue = plans.filter((p) => force || !fresh(p));
  if (queue.length) {
    const jobs = Math.min(LENS_JOBS, queue.length);
    console.log(`» lens · Rendering ${queue.length} of ${plans.length} magnifier${plans.length === 1 ? '' : 's'} · ${jobs} at a time`);
    const pending = [...queue];
    const worker = async () => {
      for (let plan = pending.shift(); plan; plan = pending.shift()) {
        const started = Date.now();
        const args = lensBakeArgs(take, plan.mark, plan.geo, rimHex, timing, plan.file);
        assertLensBakeArgs(args);
        rmSync(keyPath(plan.file), { force: true });
        await render(args);
        const sec = (Date.now() - started) / 1000;
        writeFileSync(keyPath(plan.file), JSON.stringify({ key: plan.key, pipeline: LENS_BAKE_PIPELINE, sec }));
        console.log(`» lens · ${plan.mark.label || 'Magnifier'} @ ${plan.mark.t.toFixed(1)}s · ${sec.toFixed(1)}s`);
      }
    };
    await Promise.all(Array.from({ length: jobs }, worker));
  } else {
    console.log(`» lens · Reused ${plans.length} magnifier${plans.length === 1 ? '' : 's'}`);
  }

  return {
    files: plans.map((p) => p.file),
    stamp: createHash('sha1').update(plans.map((p) => p.key).join('|')).digest('hex').slice(0, 16),
    rendered: queue.length,
  };
}
