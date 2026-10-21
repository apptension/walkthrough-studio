/**
 * Publish the manuals into the webapp's Help Center.
 *
 *   <webapp>/public/help/videos/<slug>/<slug>.mp4 + poster.jpg   served as-is by Vite
 *   <webapp>/src/routes/helpCenter/helpCenter.content.json       sets, lessons, chapters, takeaways, transcripts
 *
 * Only lessons with a delivered MP4 are published. The kit stays the source of truth: re-run after
 * `node cli.mjs all <slug>` and the Help Center picks up the new take.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SKILL } from './project.mjs';
import { collectManual } from './manual.mjs';

const WEBAPP = resolve(SKILL, '..', '..', '..', 'packages', 'webapp');
const PUBLIC_DIR = join(WEBAPP, 'public', 'help', 'videos');
const CONTENT_FILE = join(WEBAPP, 'src', 'routes', 'helpCenter', 'helpCenter.content.json');
const URL_BASE = '/help/videos';

const round = (n) => Math.round(n * 10) / 10;

export function publishHelpCenter() {
  if (!existsSync(WEBAPP)) throw new Error(`webapp not found at ${WEBAPP}`);
  const { sets, lessons } = collectManual();
  const ready = lessons.filter((l) => l.ready);
  mkdirSync(PUBLIC_DIR, { recursive: true });

  const published = ready.map((l) => {
    const dir = join(PUBLIC_DIR, l.slug);
    mkdirSync(dir, { recursive: true });
    const video = join(dir, `${l.slug}.mp4`);
    if (!existsSync(video) || statSync(video).mtimeMs < statSync(l.file).mtimeMs) copyFileSync(l.file, video);
    let poster = null;
    if (l.posterFile) {
      poster = join(dir, 'poster.jpg');
      if (!existsSync(poster) || statSync(poster).mtimeMs < statSync(l.posterFile).mtimeMs) copyFileSync(l.posterFile, poster);
    }
    return {
      slug: l.slug,
      set: l.set,
      order: l.order,
      title: l.title,
      heading: l.heading,
      tagline: l.tagline,
      summary: l.summary,
      audience: l.audience,
      durationSec: round(l.duration),
      video: `${URL_BASE}/${l.slug}/${l.slug}.mp4`,
      poster: poster ? `${URL_BASE}/${l.slug}/poster.jpg` : null,
      chapters: l.chapters.map((c) => ({
        title: c.title,
        start: round(c.start),
        steps: c.steps.map((s) => ({ title: s.title, body: s.body, start: round(s.start) })),
      })),
      takeaways: l.takeaways,
      transcript: l.transcript,
    };
  });

  // Drop folders for lessons that no longer exist
  for (const d of readdirSync(PUBLIC_DIR)) {
    if (!published.some((l) => l.slug === d)) rmSync(join(PUBLIC_DIR, d), { recursive: true, force: true });
  }

  const content = {
    generatedAt: new Date().toISOString(),
    sets: sets.map((s) => ({
      key: s.key,
      title: s.title,
      heading: s.heading || s.title,
      audience: s.audience || '',
      intro: s.intro || '',
      faq: s.faq || [],
    })),
    lessons: published,
  };
  mkdirSync(join(CONTENT_FILE, '..'), { recursive: true });
  writeFileSync(CONTENT_FILE, JSON.stringify(content, null, 2) + '\n');
  const skipped = lessons.length - ready.length;
  console.log(`✓ ${ready.length} lessons → ${PUBLIC_DIR}${skipped ? ` (${skipped} not produced yet, skipped)` : ''}`);
  console.log(`✓ content → ${CONTENT_FILE}`);
  return content;
}
