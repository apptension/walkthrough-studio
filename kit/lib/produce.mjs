/**
 * Delivery master in ONE encode:
 *   open → (live slice | interstitial plate)* → close
 * Joins overlap with xfade (style from brand/video `transitions`); plates render without their
 * black in/out, so a plate dissolves through its own brand background. The head fades up from
 * black and the tail fades out — the only black in the cut.
 * True UI color (no grade), BT.709 tagged, chapters from the edit plan.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflashGraph, flashesFor } from './deflash.mjs';
import { frameAssets, frameGraph, planZooms, zoomFilter } from './camera.mjs';
import { buildEditPlan, resolveEdit } from './edit.mjs';
import { compactEdit, editCameraMarks, liveTimeMap, resolveLenses, speedFilter, withEditLenses } from './editDeck.mjs';
import { lensGeometry, lensGraph } from './lens.mjs';
import {
  assertX264Args,
  BT709_PARAMS,
  BT709_TAGS,
  encodeSummary,
  losslessX264,
  lossyX264,
  QUALITY,
  qualityMeta,
  toBt709,
} from './encode.mjs';
import { duration, ffmpegProgress, mmss, run } from './media.mjs';
import { FPS } from './motion.mjs';
import { renderPlates } from './plates.mjs';
import { livePath } from './record.mjs';
import { cardBakeOverlayGraph, prepareLiveCardBakes } from './liveCardBake.mjs';

export { duration, run };

/** Head fade-up from black and tail fade-out of the whole master. */
const HEAD_FADE = 0.6;
const TAIL_FADE = 0.8;

export function finalPath(video) {
  return join(video.out, `${video.slug}.mp4`);
}

/** Bump when the clean-up graph or its encode settings change, so a cached live-clean rebuilds. */
const CLEAN_PIPELINE = 7;

/**
 * Prepare the full live reel once (live-card bake + deflash + lenses). Cached against the take and the graph:
 * a plate or narration edit re-runs produce without touching the recording.
 */
export async function prepareLive(video, LIVE, { width, height, cardBake: givenBake } = {}) {
  const timelinePath = join(video.out, 'timeline.json');
  const timeline = existsSync(timelinePath) ? JSON.parse(readFileSync(timelinePath, 'utf8')) : [];
  const clean = join(video.out, 'live-clean.mp4');
  const stampPath = join(video.out, 'live-clean.json');
  const cardBake = givenBake || (await prepareLiveCardBakes(video, LIVE));
  const bakeGraph =
    cardBake.mode === 'clean' && cardBake.plans.length
      ? cardBakeOverlayGraph(cardBake.plans, cardBake.files, {
          srcLabel: '[lraw]',
          outLabel: '[lbake]',
          startInputIndex: 1,
        })
      : { inputs: [], filter: [], outLabel: '[lraw]', inputCount: 0 };
  const cardInputs = bakeGraph.inputs || [];
  const inBase = 1 + (bakeGraph.inputCount || 0);

  const norm = `fps=${FPS},${toBt709(width, height)}`;
  const filter = [`[0:v]${norm}[lraw]`];
  if (bakeGraph.inputCount) filter.push(...bakeGraph.filter);
  let lv = bakeGraph.inputCount ? bakeGraph.outLabel : '[lraw]';

  const flashes = flashesFor(LIVE, join(video.out, 'flashes.json'));
  const deflash = deflashGraph(flashes.gaps, flashes.frames, lv, '[ldf]');
  if (deflash) {
    filter.push(deflash);
    lv = '[ldf]';
  }

  const liveSec = duration(LIVE);
  const camera = video.brand.direction?.camera || { zoom: 'off', frame: 'full', background: 'brand' };
  // The editor deck: manual zooms / zoom-free windows join the recorded marks; speed ramps apply last.
  const deck = resolveEdit(video, { liveDur: liveSec });
  const cameraTimeline = [...withEditLenses(timeline, deck), ...editCameraMarks(deck)].sort((a, b) => a.t - b.t);
  const zoomPlan = planZooms(cameraTimeline, { width, height, level: camera.zoom, duration: liveSec });
  const zoom = zoomFilter(zoomPlan.shots, { width, height });
  if (zoom) {
    filter.push(`${lv}${zoom},format=yuv420p,${BT709_PARAMS}[lzoom]`);
    lv = '[lzoom]';
  }

  const lensInputs = [];
  const magnifies = resolveLenses(timeline, deck);
  magnifies.forEach((m, i) => {
    const geo = lensGeometry(m, { width, height });
    const idx = inBase + i;
    lensInputs.push('-ss', m.t.toFixed(3), '-t', m.dur.toFixed(3), '-i', LIVE);
    filter.push(lensGraph(idx, i, m, geo, video.brand.colors.gold));
    filter.push(
      `${lv}[lens${i}]overlay=x='${geo.ox}':y='${geo.oy}':eval=frame:eof_action=pass:format=auto,` +
        `format=yuv420p,${BT709_PARAMS}[lz${i}]`
    );
    lv = `[lz${i}]`;
  });
  // Speed ramps run after every time-based overlay (zooms, lenses, frame), so those keep the
  // recording's clock; the ramp is the last node before [v].
  const liveMap = liveTimeMap(deck.speed, liveSec);
  const speed = speedFilter(liveMap, FPS);
  const framed = speed ? '[vf]' : '[v]';
  const frameInputs = [];
  if (camera.frame === 'inset') {
    const assets = frameAssets(video, {
      width,
      height,
      background: camera.background,
      padding: camera.padding,
      corners: camera.corners,
      shadow: camera.shadow,
    });
    const bgIdx = inBase + magnifies.length;
    const loop = ['-loop', '1', '-framerate', String(FPS), '-t', liveSec.toFixed(3), '-i'];
    frameInputs.push(...loop, assets.bg, ...loop, assets.mask);
    filter.push(frameGraph({ src: lv, out: framed, bgIdx, maskIdx: bgIdx + 1, geo: assets.geo, width, height }));
  } else {
    filter.push(`${lv}format=yuv420p,${BT709_PARAMS}${framed}`);
  }
  if (speed) filter.push(`${framed}${speed}[v]`);
  const cameraMeta = {
    zoom: camera.zoom,
    frame: camera.frame,
    background: camera.frame === 'inset' ? camera.background : undefined,
    padding: camera.frame === 'inset' ? camera.padding : undefined,
    corners: camera.frame === 'inset' ? camera.corners : undefined,
    shadow: camera.frame === 'inset' ? camera.shadow : undefined,
    zoomShots: zoomPlan.shots.length,
    manualZooms: zoomPlan.manual || 0,
    pointerTargets: zoomPlan.targets,
    skippedUnderOverlays: zoomPlan.skipped,
    editZooms: zoomPlan.shots.filter((s) => s.source === 'edit').length,
    liveCards: cardBake.mode === 'clean' ? cardBake.plans.length : 0,
  };
  const speedMeta = liveMap.identity
    ? null
    : {
        ramps: liveMap.ramps,
        recordedSec: Number(liveSec.toFixed(3)),
        cleanSec: liveMap.cleanDur,
        savedSec: Number((liveSec - liveMap.cleanDur).toFixed(3)),
      };

  const st = statSync(LIVE);
  const stamp = createHash('sha1')
    .update(
      JSON.stringify({
        CLEAN_PIPELINE,
        size: st.size,
        mtime: st.mtimeMs,
        cardBake: cardBake.stamp,
        filter,
        lensInputs,
        ...(frameInputs.length ? { frameInputs } : {}),
      })
    )
    .digest('hex')
    .slice(0, 16);
  const cached = existsSync(stampPath) ? JSON.parse(readFileSync(stampPath, 'utf8')) : null;
  const what = [
    cardBake.mode === 'clean' && cardBake.plans.length
      ? `${cardBake.plans.length} live card${cardBake.plans.length === 1 ? '' : 's'} baked`
      : cardBake.mode === 'burned'
        ? 'legacy burned cards'
        : '',
    flashes.gaps.length ? `${flashes.gaps.length} flash${flashes.gaps.length === 1 ? '' : 'es'} repaired` : 'no flashes',
    magnifies.length ? `${magnifies.length} lens${magnifies.length === 1 ? '' : 'es'}` : '',
    zoomPlan.shots.length
      ? `${zoomPlan.shots.length - (zoomPlan.manual || 0)} auto + ${zoomPlan.manual || 0} manual zoom${zoomPlan.shots.length === 1 ? '' : 's'}`
      : '',
    camera.zoom !== 'off' && !zoomPlan.targets ? 'auto zoom needs a new recording (no pointer marks)' : '',
    camera.frame === 'inset'
      ? `inset frame (${camera.background}, ${camera.padding}, ${camera.corners}, ${camera.shadow} shadow)`
      : '',
    speedMeta
      ? `${speedMeta.ramps.length} speed ramp${speedMeta.ramps.length === 1 ? '' : 's'} (${mmss(liveSec)} → ${mmss(liveMap.cleanDur)})`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (cached?.stamp === stamp && existsSync(clean)) {
    console.log(`» live · Reused the cleaned recording · ${what}`);
    return { clean, camera: cameraMeta, speed: speedMeta };
  }

  console.log(`» live · Cleaning ${mmss(liveSec)} of recording · ${what}`);
  const cleanArgs = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', LIVE, ...cardInputs, ...lensInputs, ...frameInputs,
    '-filter_complex', filter.join(';'),
    '-map', '[v]',
    '-r', String(FPS),
    ...losslessX264(QUALITY.clean.preset),
    '-pix_fmt', 'yuv420p', ...BT709_TAGS, '-an',
    clean,
  ];
  assertX264Args('clean', cleanArgs);
  await ffmpegProgress(
    cleanArgs,
    {
      label: 'prepare live (cards + deflash + lenses)',
      totalSec: liveMap.cleanDur,
      onProgress: (p) => console.log(`» live · ${progressText(p)}`),
    }
  );
  writeFileSync(stampPath, JSON.stringify({ stamp, at: new Date().toISOString(), cardBake: cardBake.stamp }, null, 2));
  console.log(`» live · Cleaned · ${what}`);
  return { clean, camera: cameraMeta, speed: speedMeta };
}

/** "42% · 1:24 of 3:20 · about 0:31 left" */
function progressText({ fraction, done, total, etaSec }) {
  const pct = Math.min(99, Math.floor(fraction * 100));
  const eta = etaSec != null && Number.isFinite(etaSec) ? ` · about ${mmss(etaSec)} left` : '';
  return `${pct}% · ${mmss(done)} of ${mmss(total)}${eta}`;
}

/** Fail before any plate work when the take is missing or truncated (a crashed record). */
function assertPlayableLive(LIVE) {
  const missing = !existsSync(LIVE);
  let sec = 0;
  if (!missing) {
    try {
      sec = duration(LIVE);
    } catch {
      sec = 0;
    }
  }
  if (missing || !(sec > 1)) {
    const reason = missing
      ? 'There is no recording yet. Record the walkthrough first.'
      : 'The last recording did not finish. Record the walkthrough, then build the master again.';
    console.log(`» live · ${reason}`);
    throw new Error(reason);
  }
}

export async function produce(video, { forcePlates = false, live, out } = {}) {
  const { config, brand } = video;
  const LIVE = live || livePath(video);
  const FINAL = out || finalPath(video);
  assertPlayableLive(LIVE);

  const platesStarted = Date.now();
  const cardsStarted = Date.now();
  let platesSec = 0;
  let cardsSec = 0;
  const [, cardBake] = await Promise.all([
    renderPlates(video, { force: forcePlates }).then((rows) => {
      platesSec = (Date.now() - platesStarted) / 1000;
      return rows;
    }),
    prepareLiveCardBakes(video, LIVE).then((bake) => {
      cardsSec = (Date.now() - cardsStarted) / 1000;
      return bake;
    }),
  ]);
  const { width, height } = config.record.viewport;
  const cleanStarted = Date.now();
  const { clean: cleanLive, camera, speed } = await prepareLive(video, LIVE, { width, height, cardBake });
  const cleanSec = (Date.now() - cleanStarted) / 1000;
  const plan = buildEditPlan(video);

  // Live segments read straight from the cleaned reel (frame-accurate input seek): no slice
  // files, one generation fewer between the take and the master.
  const inputs = plan.segments.flatMap((seg) =>
    seg.kind === 'plate'
      ? ['-i', seg.file]
      : ['-ss', seg.start.toFixed(3), '-t', (seg.end - seg.start).toFixed(3), '-i', cleanLive]
  );
  rmSync(join(video.out, 'slices'), { recursive: true, force: true });
  const joins = plan.segments.slice(1).map((s) => `${s.transitionIn.type}/${s.transitionIn.dur.toFixed(2)}s`);
  console.log(`» plan · ${plan.segments.length} shots · ${joins.length} dissolve${joins.length === 1 ? '' : 's'}`);
  console.log(
    `· transitions: ${plan.transitions.style} ${plan.transitions.duration}s · ${joins.length} join(s)` +
      (plan.segments.some((s) => s.transitionIn?.card) ? ' · plate→chapter cards dissolve' : '')
  );

  const labels = { intro: 'Introduction', start: 'Getting started', summary: 'Summary', ...config.chapterLabels };
  const chapterMarks = [
    { title: labels.intro, start: 0 },
    ...plan.timeline
      .filter((m) => m.kind === 'chapter')
      .map((m) => ({ title: m.label, start: plan.liveToDelivery(m.t) })),
    ...plan.segments
      .filter((s) => s.interstitial)
      .map((s) => ({ title: s.title || s.id, start: s.at + (s.transitionIn?.dur || 0) / 2 })),
    { title: labels.summary, start: plan.total - plan.dClose },
  ].sort((a, b) => a.start - b.start);
  const chaptersDedup = [];
  for (const c of chapterMarks) {
    if (!chaptersDedup.length || Math.abs(chaptersDedup[chaptersDedup.length - 1].start - c.start) > 0.15) {
      chaptersDedup.push(c);
    }
  }

  const ms = (s) => Math.round(s * 1000);
  const metaPath = join(video.out, 'chapters.ffmeta');
  writeFileSync(
    metaPath,
    [
      ';FFMETADATA1',
      `title=${brand.name} — ${config.title}`,
      ...chaptersDedup.flatMap((c, i) => {
        const end = i + 1 < chaptersDedup.length ? chaptersDedup[i + 1].start : plan.total;
        return ['[CHAPTER]', 'TIMEBASE=1/1000', `START=${ms(c.start)}`, `END=${ms(end)}`, `title=${c.title}`];
      }),
    ].join('\n')
  );

  // xfade needs identical size/fps/timebase on both inputs; each input is trimmed to its planned
  // length so frame-grid rounding never drifts the offsets.
  const norm = `fps=${FPS},${toBt709(width, height)}`;
  const n = plan.segments.length;
  const filter = plan.segments.map((s, i) => {
    const hold = s.padOut > 0 ? `,tpad=stop_mode=clone:stop_duration=${(s.padOut + 0.1).toFixed(4)}` : '';
    return `[${i}:v]setpts=PTS-STARTPTS,${norm}${hold},trim=duration=${s.dur.toFixed(4)},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`;
  });
  let acc = '[v0]';
  for (let i = 1; i < n; i++) {
    const { xfade, dur } = plan.segments[i].transitionIn;
    const label = `[x${i}]`;
    filter.push(
      `${acc}[v${i}]xfade=transition=${xfade}:duration=${dur.toFixed(4)}:offset=${plan.segments[i].at.toFixed(4)}${label}`
    );
    acc = label;
  }
  filter.push(
    `${acc}fade=t=in:st=0:d=${HEAD_FADE},fade=t=out:st=${Math.max(0, plan.total - TAIL_FADE).toFixed(3)}:d=${TAIL_FADE},format=yuv420p,${BT709_PARAMS}[v]`
  );

  console.log(`» encode · Starting · ${mmss(plan.total)} master, ${n - 1} joins`);
  const encodeStarted = Date.now();
  const deliveryArgs = [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...inputs,
    '-i', metaPath,
    '-filter_complex', filter.join(';'),
    '-map', '[v]', '-map_metadata', String(n), '-map_chapters', String(n),
    '-r', String(FPS),
    ...lossyX264(QUALITY.delivery),
    '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p',
    '-g', '60', '-keyint_min', '30', '-bf', '2',
    ...BT709_TAGS,
    '-movflags', '+faststart', '-an',
    FINAL,
  ];
  assertX264Args('delivery', deliveryArgs);
  await ffmpegProgress(
    deliveryArgs,
    {
      label: `delivery encode (${n} segments, ${n - 1} transitions)`,
      totalSec: plan.total,
      onProgress: (p) => console.log(`» encode · ${progressText(p)}`),
    }
  );
  const encodeSec = (Date.now() - encodeStarted) / 1000;
  console.log(`» encode · Done · ${mmss(plan.total)} master`);
  console.log(
    `» timing · plates ${platesSec.toFixed(1)}s · cards ${cardsSec.toFixed(1)}s · clean ${cleanSec.toFixed(1)}s · encode ${encodeSec.toFixed(1)}s`
  );

  const interstitialSec = plan.interstitials.reduce((s, i) => s + i.dur, 0);
  const editSegments = plan.segments.map((s) => ({
    kind: s.kind,
    id: s.id,
    title: s.title,
    type: s.type,
    interstitial: s.interstitial || undefined,
    at: Number(s.at.toFixed(3)),
    dur: Number(s.dur.toFixed(3)),
    ...(s.start != null ? { start: s.start, end: s.end } : {}),
    ...(s.opensOnCard ? { opensOnCard: s.opensOnCard } : {}),
    ...(s.padOut ? { padOut: s.padOut } : {}),
    ...(s.join ? { join: s.join } : {}),
    transitionIn: s.transitionIn,
  }));
  const meta = {
    final: FINAL,
    durationSec: Number(duration(FINAL).toFixed(2)),
    sizeMB: Math.round((statSync(FINAL).size / 1024 / 1024) * 10) / 10,
    segments: {
      openSec: plan.dOpen,
      liveSec: plan.dLive,
      closeSec: plan.dClose,
      interstitialSec,
      /** Full delivery length music must cover (open + live + interstitials + close). */
      totalSec: plan.total,
      interstitials: plan.interstitials.map((i) => ({ id: i.id, type: i.type, dur: i.dur, before: i.before })),
    },
    liveOffsetSec: plan.dOpen,
    transitions: plan.transitions,
    camera,
    speed,
    editDeck: compactEdit(plan.edit) || null,
    edit: editSegments,
    chapters: chaptersDedup,
    encode: encodeSummary(plan.transitions.style),
    quality: qualityMeta(),
    grade: 'none — true UI color',
    generatedAt: new Date().toISOString(),
    timing: {
      platesSec: Number(platesSec.toFixed(1)),
      cardsSec: Number(cardsSec.toFixed(1)),
      cleanSec: Number(cleanSec.toFixed(1)),
      encodeSec: Number(encodeSec.toFixed(1)),
    },
  };
  if (!out) {
    const priorPath = join(video.out, 'produce-meta.json');
    if (existsSync(priorPath)) {
      try {
        const prior = JSON.parse(readFileSync(priorPath, 'utf8'));
        if (prior.timing) {
          const previous = { ...prior.timing };
          delete previous.previous;
          meta.timing.previous = previous;
        }
      } catch {
        /* a broken sidecar must not block the new master */
      }
    }
  }
  if (!out) {
    writeFileSync(join(video.out, 'produce-meta.json'), JSON.stringify(meta, null, 2));
    writeFileSync(
      join(video.out, 'edit-plan.json'),
      JSON.stringify({ segments: editSegments, total: plan.total, transitions: plan.transitions }, null, 2)
    );
    for (const stale of [FINAL.replace(/\.mp4$/, '.silent.mp4'), join(video.out, 'audio-meta.json')]) {
      if (existsSync(stale)) rmSync(stale);
    }
  }
  const interstitialCount = plan.interstitials.length;
  console.log(
    `✓ ${FINAL}\n  ${meta.durationSec}s · ${meta.sizeMB} MB · ${chaptersDedup.length} chapters` +
      (interstitialCount ? ` · ${interstitialCount} interstitial plate(s)` : '')
  );
  if (!out) {
    try {
      const { snapshotVersion } = await import('./versions.mjs');
      snapshotVersion(video, {
        trigger: 'produce',
        kind: 'checkpoint',
        title: 'Picture lock',
        note: 'auto after produce',
      });
    } catch (err) {
      console.log(`· version snapshot skipped: ${err.message}`);
    }
  }
  return meta;
}
