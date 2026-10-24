/**
 * Does the music bed cover the picture without repeats? Reads what the last mix did
 * (`audio-meta.json → musicFit`) and the composed bed (`music/plan.json`); older mixes without
 * a fit record are judged from the durations and the desk's loop switch.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TOLERANCE_SEC = 0.35;

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

/** Issues from a mix record; `pictureSec` is the delivered length. */
export function musicCoverageIssues({ audioMeta, plan, pictureSec }) {
  const issues = [];
  if (!audioMeta?.music) return issues;
  const fit = audioMeta.musicFit;
  const bedSec = Number(plan?.durationSec) || 0;
  if (fit) {
    if (fit.kind === 'loop') issues.push(`music loops: a ${(fit.cut - fit.from).toFixed(1)}s passage repeats ${fit.joins}× — compose to fit`);
    if (fit.kind === 'extend') issues.push(`music repeats ${(fit.cut - fit.from).toFixed(1)}s of the demo bed to cover a longer take — compose to fit`);
    if (fit.shortfallSec > TOLERANCE_SEC) issues.push(`music ends ${fit.shortfallSec.toFixed(1)}s before the picture`);
    return issues;
  }
  if (bedSec && pictureSec && bedSec + TOLERANCE_SEC < pictureSec) {
    issues.push(
      audioMeta.desk?.music?.loop
        ? `music bed (${bedSec.toFixed(1)}s) is shorter than the picture (${pictureSec.toFixed(1)}s) and was hard-looped by an older mix — re-run mix or compose to fit`
        : `music bed (${bedSec.toFixed(1)}s) is shorter than the picture (${pictureSec.toFixed(1)}s) — the tail is silent`
    );
  }
  return issues;
}

export function checkMusicCoverage(video) {
  const audioMeta = readJson(join(video.out, 'audio-meta.json'));
  const plan = readJson(join(video.out, 'music', 'plan.json'));
  const produceMeta = readJson(join(video.out, 'produce-meta.json'));
  const pictureSec = Number(audioMeta?.musicFit?.pictureSec || produceMeta?.durationSec) || 0;
  const issues = musicCoverageIssues({ audioMeta, plan, pictureSec });
  return { checked: Boolean(audioMeta?.music), issues, fit: audioMeta?.musicFit || null };
}
