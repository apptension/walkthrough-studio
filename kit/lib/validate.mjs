/**
 * Frame-accurate QC (`-ss` before `-i`): plate holds, both joins, every chapter card
 * and the clean frame after it, sampled captions; plus a contact sheet and a
 * review page. Read the JPEGs before calling a video done.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkMusicCoverage } from './audio/coverage.mjs';
import { scanFlashes } from './deflash.mjs';
import { buildEditPlan } from './edit.mjs';
import { masterQualityError } from './encode.mjs';
import { STILL_JPEG_ARGS } from './media.mjs';
import { finalPath } from './produce.mjs';
import { platePaths } from './plates.mjs';
import { esc } from './text.mjs';

/** Frame-accurate grab. `-ss` before `-i` seeks by keyframe and lands on the same frame. */
export function qcGrabArgs(file, t, out) {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Number(t).toFixed(3), '-i', file, ...STILL_JPEG_ARGS, out];
}

export function validate(video) {
  const FINAL = finalPath(video);
  const metaPath = join(video.out, 'produce-meta.json');
  if (!existsSync(FINAL) || !existsSync(metaPath)) throw new Error(`Run: node cli.mjs produce ${video.slug}`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const plan = buildEditPlan(video);
  // Marks on the cleaned clock (speed ramps applied) so every grab lands where the master shows it.
  const { liveToDelivery, segments, dOpen, dClose, total, timeline } = plan;
  const dur = meta.durationSec;
  const dir = join(video.out, 'validate');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const shots = [
    ['00-open-build', 1.6],
    ['01-open-hold', 4.6],
    ['02-join-open-live', dOpen + 0.3],
    ['03-live-first', dOpen + 1.6],
  ];
  // Interstitial plate holds (mid-plate) and the midpoint of every join (mid-transition frame)
  for (const [i, seg] of segments.entries()) {
    if (seg.interstitial) shots.push([`plate-${seg.id}`, seg.at + seg.dur * 0.45]);
    if (i > 0 && seg.transitionIn?.dur) {
      shots.push([`x-${segments[i - 1].id}-${seg.id}`.slice(0, 40), seg.at + seg.transitionIn.dur / 2]);
    }
  }
  timeline
    .filter((m) => m.kind === 'chapter')
    .forEach((m, i) => {
      const at = liveToDelivery(m.t);
      shots.push([`ch${i + 1}-hold`, at + 1.5]);
      shots.push([`ch${i + 1}-after`, at + 3.4]);
    });
  const captions = timeline.filter((m) => m.kind === 'caption');
  const step = Math.max(1, Math.floor(captions.length / 8));
  captions
    .filter((_, i) => i % step === 0)
    .forEach((m, i) => shots.push([`cap${String(i + 1).padStart(2, '0')}`, liveToDelivery(m.t) + 1.2]));
  shots.push(['90-live-last', total - dClose - 1.5]);
  shots.push(['91-join-live-close', total - dClose + 0.2]);
  shots.push(['92-close-hold', dur - 2.0]);
  shots.sort((a, b) => a[1] - b[1]);
  // Index prefix keeps the contact sheet (glob order) chronological
  shots.forEach((s, i) => (s[0] = `${String(i).padStart(2, '0')}-${s[0].replace(/^\d+-/, '')}`));

  const qualityError = masterQualityError(meta);
  if (qualityError) {
    process.exitCode = 1;
    console.log(`» quality · ${qualityError}`);
    console.log(`✗ ${qualityError}`);
  } else {
    console.log(`» quality · ${meta.quality.delivery} · ${meta.quality.intermediates}`);
  }

  console.log(`» frames · Sampling ${shots.length} frames`);
  for (const [name, t] of shots) {
    const r = spawnSync('ffmpeg', qcGrabArgs(FINAL, t, join(dir, `${name}.jpg`)), { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`grab ${name}: ${r.stderr}`);
    console.log('·', name.padEnd(20), `${t.toFixed(2)}s`);
  }

  const cols = 4;
  const sheet = join(dir, 'contact-sheet.jpg');
  spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-pattern_type', 'glob', '-i', join(dir, '*.jpg'),
      '-vf', `scale=640:360:flags=lanczos,tile=${cols}x${Math.ceil(shots.length / cols)}:padding=6:color=white`,
      '-q:v', '2', '-frames:v', '1', '-update', '1', sheet,
    ],
    { encoding: 'utf8' }
  );
  // Blank frames at deliberate plate↔live joins (open, each interstitial, close) are expected
  const joins = segments.map((seg) => seg.at + (seg.transitionIn?.dur || 0) / 2);
  joins.push(dur);
  const flashes = scanFlashes(FINAL)
    .gaps.map((g) => ({ start: g.first / 30, end: (g.last + 1) / 30 }))
    .filter((g) => !joins.some((j) => g.start <= j + 0.45 && g.end >= j - 0.45));
  if (flashes.length) {
    process.exitCode = 1;
    console.log(`» flashes · ${flashes.length} left`);
    console.log(`✗ ${flashes.length} flash(es) left: ${flashes.map((g) => `${g.start.toFixed(2)}s`).join(', ')}`);
  } else {
    console.log('» flashes · No flashes');
    console.log('✓ no flashes in the delivered file');
  }
  const music = checkMusicCoverage(video);
  if (music.issues.length) {
    console.log(`» music · ${music.issues.length} coverage issue(s)`);
    for (const issue of music.issues) console.log(`⚠ ${issue}`);
  } else if (music.checked) {
    console.log('✓ music covers the picture without repeats');
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ durationSec: dur, liveOffsetSec: dOpen, shots, flashes, music: music.issues }, null, 2));
  const review = writeReview(video, meta, shots);
  console.log(`✓ ${shots.length} QC frames + contact sheet → ${dir}\n✓ review page → ${review}`);
  return { dir, sheet, review, shots };
}

export function writeReview(video, meta, shots = []) {
  const plates = platePaths(video);
  const rel = (p) => relative(video.out, p);
  const chapterList = (meta?.chapters || [])
    .map((c) => `<li><span>${c.start.toFixed(1)}s</span>${esc(c.title)}</li>`)
    .join('');
  const interstitialVideos = Object.entries(plates.interstitial || {})
    .map(([, p]) => `<video src="${rel(p.mp4)}" controls muted></video>`)
    .join('');
  const frames = shots
    .map(([name]) => `<figure><img src="validate/${name}.jpg" loading="lazy"/><figcaption>${name}</figcaption></figure>`)
    .join('');
  const voicePath = join(video.out, 'voice', 'voice.json');
  const voice = existsSync(voicePath) ? JSON.parse(readFileSync(voicePath, 'utf8')) : null;
  const audioPath = join(video.out, 'audio-meta.json');
  const audio = existsSync(audioPath) ? JSON.parse(readFileSync(audioPath, 'utf8')) : null;
  const narration = voice
    ? `<h2>Narration${voice.mode === 'stub' ? ' <em>(stub voice — plumbing only)</em>' : ` · ${esc(voice.voice.name || '')}`}</h2>
<table class="vo">${voice.clips
        .map(
          (c) =>
            `<tr class="${c.notes.length ? 'warn' : ''}"><td>${c.start.toFixed(1)}s</td><td>${c.duration.toFixed(1)}s</td><td>${esc(c.key)}</td><td>${esc(
              c.text.replace(/^\[[^\]]*\]\s*/, '')
            )}</td><td>${esc(c.notes.join('; '))}</td></tr>`
        )
        .join('')}</table>
${audio ? `<p class="mix">Mix: ${audio.voiceClips} clips${audio.music ? ' + music bed' : ''} · master ${audio.loudness.target.lufs} LUFS / ${audio.loudness.target.truePeakDb} dBTP</p>` : '<p class="mix">Audio not mixed yet — run: node cli.mjs audio ' + esc(video.slug) + '</p>'}`
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(video.config.title)} — review</title>
<style>
  body{margin:0;background:#0b0f17;color:#e2e8f0;font:15px/1.5 ui-sans-serif,system-ui,sans-serif;padding:40px}
  h1{font-size:26px;margin:0 0 4px} p{color:#94a3b8;margin:0 0 28px}
  video{width:100%;max-width:1200px;border-radius:12px;background:#000;display:block}
  .row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;max-width:1200px;margin-top:20px}
  .row video{max-width:none} h2{font-size:15px;color:#f6aa1e;letter-spacing:.12em;text-transform:uppercase;margin:36px 0 12px}
  ol{list-style:none;padding:0;columns:2;max-width:1200px} li span{display:inline-block;width:64px;color:#64748b}
  .frames{display:grid;grid-template-columns:repeat(4,1fr);gap:12px} figure{margin:0} img{width:100%;border-radius:8px}
  figcaption{font-size:12px;color:#64748b;margin-top:4px}
  table.vo{border-collapse:collapse;max-width:1200px;font-size:13px} .vo td{padding:6px 10px;border-top:1px solid #1e293b;vertical-align:top}
  .vo td:nth-child(1),.vo td:nth-child(2){color:#64748b;white-space:nowrap} .vo td:nth-child(3){color:#f8fafc;white-space:nowrap}
  .vo tr.warn td:nth-child(5){color:#f6aa1e} .mix{margin-top:12px} h2 em{color:#f47425;text-transform:none;letter-spacing:0;font-style:normal}
</style></head><body>
<h1>${esc(video.config.title)}</h1>
<p>${meta ? `${meta.durationSec}s · ${meta.sizeMB} MB · ${meta.chapters.length} chapters` : 'plates only'}</p>
${meta ? `<video src="${rel(meta.final)}" controls preload="metadata"></video>` : ''}
<h2>Brand plates</h2>
<div class="row"><video src="${rel(plates.open.mp4)}" controls muted></video><video src="${rel(plates.close.mp4)}" controls muted></video></div>
${interstitialVideos ? `<h2>Interstitial plates</h2><div class="row">${interstitialVideos}</div>` : ''}
${chapterList ? `<h2>Chapters</h2><ol>${chapterList}</ol>` : ''}
${narration}
${frames ? `<h2>QC frames</h2><div class="frames">${frames}</div>` : ''}
</body></html>`;
  const path = join(video.out, 'review.html');
  writeFileSync(path, html);
  return path;
}
