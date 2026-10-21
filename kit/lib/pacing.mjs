/**
 * Professional pacing / QC report — soft gates beyond validate's hard fail list.
 * Catches tutorial smells: VO pile-ups, dead air, long shots, missing captions, etc.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadVoiceClips } from './captions.mjs';
import { loadTimeline } from './edit.mjs';

const SEVERITY = { pass: 0, info: 1, warn: 2, fail: 3 };

function finding(severity, code, message, meta = {}) {
  return { severity, code, message, ...meta };
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function runPacingQc(video, { write = true } = {}) {
  const findings = [];
  const editPlan = readJson(join(video.out, 'edit-plan.json'));
  const produceMeta = readJson(join(video.out, 'produce-meta.json'));
  const timeline = loadTimeline(video);
  const clips = loadVoiceClips(video);
  const totalSec =
    produceMeta?.durationSec ??
    editPlan?.total ??
    clips.at(-1)?.end ??
    0;

  if (!editPlan && !produceMeta) {
    findings.push(finding('fail', 'no-produce', 'produce-meta / edit-plan missing — run produce first'));
  }

  const liveSegs = (editPlan?.segments || []).filter((s) => s.kind === 'live');
  const longLive = liveSegs.filter((s) => s.dur > 55);
  if (longLive.length) {
    findings.push(
      finding(
        'warn',
        'long-live',
        `${longLive.length} live segment(s) longer than 55s without a plate break`,
        { ids: longLive.map((s) => s.id) },
      ),
    );
  }
  const shortLive = liveSegs.filter((s) => s.dur < 2.5);
  if (shortLive.length) {
    findings.push(
      finding(
        'info',
        'flash-live',
        `${shortLive.length} live segment(s) under 2.5s — may feel choppy after a plate`,
        { ids: shortLive.map((s) => s.id) },
      ),
    );
  }

  // Live pace: how much of the take waited for narration rather than showing the product.
  const liveMeta = readJson(join(video.out, 'live-meta.json'));
  const pace = liveMeta?.pace;
  if (pace && pace.narrationHoldSec >= 3) {
    const pct = Math.round((pace.narrationHoldShare || 0) * 100);
    const heldFor = (liveMeta.timeline || [])
      .filter((m) => m.kind === 'hold' && m.dur >= 1.5)
      .sort((a, b) => b.dur - a.dur)
      .slice(0, 3)
      .map((m) => `${m.for} (${m.dur.toFixed(1)}s)`);
    findings.push(
      finding(
        pct >= 20 ? 'warn' : 'info',
        'narration-bound',
        `live waited ${pace.narrationHoldSec}s (${pct}%) for narration at pace ${pace.id}${
          pct >= 20 ? ' — trim the longest lines or raise voice speed; a faster pace cannot shorten this' : ''
        }`,
        { holdSec: pace.narrationHoldSec, share: pace.narrationHoldShare, pace: pace.id, heldFor },
      ),
    );
  }

  const chapters = timeline.filter((m) => m.kind === 'chapter');
  if (chapters.length >= 2) {
    for (let i = 1; i < chapters.length; i++) {
      const gap = chapters[i].t - chapters[i - 1].t;
      if (gap > 40) {
        findings.push(
          finding(
            'warn',
            'chapter-gap',
            `${gap.toFixed(0)}s between “${chapters[i - 1].label}” → “${chapters[i].label}”`,
            { from: chapters[i - 1].label, to: chapters[i].label, gap },
          ),
        );
      }
    }
  }

  if (!clips.length) {
    findings.push(finding('fail', 'no-voice', 'voice/voice.json missing — run audio first'));
  } else {
    for (let i = 1; i < clips.length; i++) {
      const gap = clips[i].start - clips[i - 1].end;
      // Tutorial VO often breathes 2–4s between lines while the UI settles.
      // Only warn on long empty stretches that feel unfinished.
      if (gap > 6.5) {
        findings.push(
          finding(
            'warn',
            'dead-air',
            `${gap.toFixed(1)}s silence between ${clips[i - 1].key} → ${clips[i].key}`,
            { gap, from: clips[i - 1].key, to: clips[i].key },
          ),
        );
      } else if (gap > 5) {
        findings.push(
          finding(
            'info',
            'breath',
            `${gap.toFixed(1)}s pause between ${clips[i - 1].key} → ${clips[i].key}`,
            { gap, from: clips[i - 1].key, to: clips[i].key },
          ),
        );
      }
      if (gap < -0.05) {
        findings.push(
          finding(
            'fail',
            'vo-overlap',
            `VO overlap ${clips[i - 1].key} / ${clips[i].key} (${gap.toFixed(2)}s)`,
            { from: clips[i - 1].key, to: clips[i].key },
          ),
        );
      }
    }

    for (const c of clips) {
      if (c.duration > 18) {
        findings.push(
          finding(
            'warn',
            'long-line',
            `${c.key} is ${c.duration.toFixed(1)}s — split for captions & pacing`,
            { key: c.key, duration: c.duration },
          ),
        );
      }
      const words = c.text.split(/\s+/).filter(Boolean).length;
      const wpm = c.duration > 0 ? (words / c.duration) * 60 : 0;
      if (wpm > 180) {
        findings.push(
          finding(
            'warn',
            'fast-vo',
            `${c.key} ~${Math.round(wpm)} WPM — tutorial VO usually 140–160`,
            { key: c.key, wpm: Math.round(wpm) },
          ),
        );
      }
      if (words > 0 && wpm < 90 && c.duration > 4) {
        findings.push(
          finding(
            'info',
            'slow-vo',
            `${c.key} ~${Math.round(wpm)} WPM — may feel padded`,
            { key: c.key, wpm: Math.round(wpm) },
          ),
        );
      }
      if (c.notes?.length) {
        findings.push(
          finding('info', 'vo-notes', `${c.key}: ${c.notes.join('; ')}`, { key: c.key }),
        );
      }
    }

    // Tail silence after last VO before close plate
    const last = clips.at(-1);
    if (last && totalSec > 0) {
      const tail = totalSec - last.end;
      if (tail > 8) {
        findings.push(
          finding(
            'info',
            'long-tail',
            `${tail.toFixed(1)}s after last VO before end — check close plate length`,
            { tail },
          ),
        );
      }
    }
  }

  const captionsDir = join(video.out, 'captions');
  if (!existsSync(join(captionsDir, `${video.slug}.srt`))) {
    findings.push(
      finding('warn', 'no-captions', 'No SRT yet — run `captions` or `deliver` before handoff'),
    );
  }

  const poster = join(video.out, 'poster.jpg');
  if (!existsSync(poster)) {
    findings.push(
      finding('info', 'no-poster', 'No poster.jpg — run `deliver` to extract a thumbnail'),
    );
  }

  const validatePath = join(video.out, 'validate-report.json');
  if (existsSync(validatePath)) {
    try {
      const vr = JSON.parse(readFileSync(validatePath, 'utf8'));
      if (vr.ok === false) {
        findings.push(finding('fail', 'validate-failed', 'Last validate reported failures'));
      }
    } catch {
      /* ignore */
    }
  }

  const worst = findings.reduce((m, f) => Math.max(m, SEVERITY[f.severity] ?? 0), 0);
  const status = ['pass', 'info', 'warn', 'fail'][worst] || 'pass';
  const report = {
    slug: video.slug,
    status,
    totalSec,
    cueCount: clips.length,
    liveSegments: liveSegs.length,
    chapterCount: chapters.length,
    generatedAt: new Date().toISOString(),
    summary: {
      fail: findings.filter((f) => f.severity === 'fail').length,
      warn: findings.filter((f) => f.severity === 'warn').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
    findings,
  };

  if (write) {
    const outPath = join(video.out, 'qc-report.json');
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(
      `✓ QC → ${outPath} [${status}] · ${report.summary.fail} fail · ${report.summary.warn} warn · ${report.summary.info} info`,
    );
  }
  return report;
}
