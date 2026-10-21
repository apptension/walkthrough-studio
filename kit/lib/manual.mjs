/**
 * Manuals: every video whose config has `manual: { set, order, summary }` becomes a lesson on
 * <OUT_ROOT>/manuals/<set>.html (player, clickable chapters, takeaways, narration transcript).
 * Set titles and intros come from videos/manuals.json; index.html links the sets.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { OUT_ROOT, VIDEOS, listVideos, loadBrand, loadVideo } from './project.mjs';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Plate copy marks the accent word as *word*. */
const accent = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');
const plain = (s) => String(s ?? '').replace(/\*/g, '');
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

/**
 * Caption bodies from flow.mjs: `say('Title', 'Body', …)` / `chapter('Title', 'Body')` with literal strings.
 * Timelines recorded before bodies were marked have only the titles, so this fills them in.
 */
function captionBodies(dir, env = {}) {
  const flow = join(dir, 'flow.mjs');
  if (!existsSync(flow)) return new Map();
  const src = readFileSync(flow, 'utf8');
  const re = /\b(?:say|chapter)\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*(['"`])((?:\\.|(?!\3).)*)\3/g;
  // `${env.marina}` / `${config.env.marina}` resolve from video.config.json; any other expression drops the body.
  const fill = (s) => {
    let unresolved = false;
    const out = s.replace(/\$\{\s*(?:config\.)?env\.(\w+)\s*\}|\$\{[^}]*\}/g, (m, key) => {
      if (key && env[key] !== undefined) return String(env[key]);
      unresolved = true;
      return '';
    });
    return unresolved ? '' : out.replace(/\\(['"`])/g, '$1');
  };
  const map = new Map();
  for (const m of src.matchAll(re)) if (!map.has(m[2])) map.set(fill(m[2]) || m[2], fill(m[4]));
  return map;
}

/** Chapters with the captions shown during each one (from timeline.json, bodies from the mark or flow.mjs). */
function chaptersWithSteps(meta, timeline, bodies) {
  const offset = meta?.liveOffsetSec || 0;
  const chapters = (meta?.chapters || []).filter((c) => c.title !== 'Introduction').map((c) => ({ ...c, steps: [] }));
  if (!chapters.length) return chapters;
  for (const e of timeline || []) {
    if (e.kind !== 'caption') continue;
    const t = e.t + offset;
    let target = chapters[0];
    for (const c of chapters) if (c.start <= t + 0.05) target = c;
    if (target.steps.some((s) => s.title === e.label)) continue;
    target.steps.push({ title: e.label, body: e.body || bodies.get(e.label) || '', start: Math.max(0, t) });
  }
  return chapters;
}

/** Everything the manuals know about one video, with absolute file paths. */
function lessonOf(slug) {
  const video = loadVideo(slug);
  const { config, out, dir } = video;
  const meta = readJson(join(out, 'produce-meta.json'));
  const voice = readJson(join(out, 'voice', 'voice.json'));
  const timeline = readJson(join(out, 'timeline.json'));
  const file = join(out, `${slug}.mp4`);
  const poster = ['01-open-hold.jpg', '03-live-first.jpg'].map((f) => join(out, 'validate', f)).find(existsSync);
  return {
    slug,
    set: config.manual.set,
    order: config.manual.order ?? 99,
    title: config.title,
    summary: config.manual.summary || '',
    audience: config.audience || '',
    heading: (config.open?.title || [config.title]).join(' '),
    tagline: config.open?.sub || '',
    takeaways: config.close?.steps || [],
    ready: existsSync(file) && !!meta,
    file,
    posterFile: poster,
    duration: meta?.durationSec || 0,
    chapters: chaptersWithSteps(meta, timeline, captionBodies(dir, config.env)),
    transcript: (voice?.clips || []).map((c) => c.text.replace(/^\[[^\]]*\]\s*/, '')).filter(Boolean),
    brand: config.brand,
  };
}

/** Sets (from videos/manuals.json) and lessons (every video with a `manual` block), lessons sorted by set order. */
export function collectManual() {
  const defs = readJson(join(VIDEOS, 'manuals.json')) || {};
  const lessons = listVideos()
    .filter((slug) => readJson(join(VIDEOS, slug, 'video.config.json'))?.manual?.set)
    .map(lessonOf)
    .sort((a, b) => a.set.localeCompare(b.set) || a.order - b.order);
  const keys = [...new Set([...Object.keys(defs), ...lessons.map((l) => l.set)])];
  const sets = keys.map((key) => ({ key, title: defs[key]?.title || key, ...defs[key] }));
  return { sets, lessons };
}

function lessonHtml(l, i) {
  const n = String(i + 1).padStart(2, '0');
  if (!l.ready) {
    return `<section class="lesson pending" id="${esc(l.slug)}"><div class="num">${n}</div><div class="body">
<h2>${esc(l.title)}</h2><p class="summary">${esc(l.summary)}</p><p class="soon">Video in production</p></div></section>`;
  }
  const chapters = l.chapters
    .map((c) => `<li><button data-t="${c.start}"><span>${clock(c.start)}</span>${esc(c.title)}</button></li>`)
    .join('');
  const takeaways = l.takeaways.map((s) => `<li><strong>${esc(s.label)}</strong><span>${esc(s.note)}</span></li>`).join('');
  const transcript = l.transcript.map((t) => `<p>${esc(t)}</p>`).join('');
  return `<section class="lesson" id="${esc(l.slug)}">
<div class="num">${n}</div>
<div class="body">
  <p class="eyebrow">${clock(l.duration)} · ${l.chapters.length} chapters</p>
  <h2>${esc(l.title)}</h2>
  <p class="summary">${esc(l.summary)}</p>
  <div class="grid">
    <video src="${esc(l.src)}" ${l.poster ? `poster="${esc(l.poster)}"` : ''} controls preload="metadata"></video>
    <aside>
      ${chapters ? `<h3>Chapters</h3><ol class="chapters">${chapters}</ol>` : ''}
    </aside>
  </div>
  ${takeaways ? `<h3>Key takeaways</h3><ul class="takeaways">${takeaways}</ul>` : ''}
  ${transcript ? `<details><summary>Read the narration</summary>${transcript}</details>` : ''}
</div></section>`;
}

function page({ brand, title, intro, audience, lessons, sets, current }) {
  const c = brand.colors;
  const nav = sets
    .map((s) => `<a href="${esc(s.key)}.html" class="${s.key === current ? 'on' : ''}">${esc(s.title)}</a>`)
    .join('');
  const toc = lessons
    .map((l, i) => `<li><a href="#${esc(l.slug)}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(l.title)}${l.ready ? `<em>${clock(l.duration)}</em>` : '<em>soon</em>'}</a></li>`)
    .join('');
  const total = lessons.reduce((s, l) => s + l.duration, 0);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)} — ${esc(brand.name)}</title>
<link rel="stylesheet" href="${esc(brand.font?.css || '')}"/>
<style>
  :root{--ink:${c.ink};--surface:${c.surface};--gold:${c.gold};--amber:${c.amber};--text:${c.text};--muted:${c.muted}}
  *{box-sizing:border-box} html{scroll-behavior:smooth}
  body{margin:0;background:var(--ink);color:var(--text);font:16px/1.6 '${esc(brand.font?.family || 'Inter')}',ui-sans-serif,system-ui,sans-serif}
  header{padding:28px 56px;display:flex;align-items:center;gap:32px;border-bottom:1px solid #ffffff14;position:sticky;top:0;background:${c.ink}ee;backdrop-filter:blur(10px);z-index:2}
  header .mark{font-weight:700;letter-spacing:.02em} header .mark span{color:var(--muted);font-weight:500;margin-left:10px}
  header nav{margin-left:auto;display:flex;gap:8px} header nav a{color:var(--muted);text-decoration:none;padding:8px 14px;border-radius:999px;font-size:14px}
  header nav a.on,header nav a:hover{color:var(--text);background:var(--surface)}
  .hero{padding:72px 56px 40px;max-width:1280px;margin:0 auto}
  .hero .eyebrow{color:var(--gold);letter-spacing:.16em;text-transform:uppercase;font-size:13px;font-weight:600}
  .hero h1{font-size:52px;line-height:1.1;margin:12px 0 16px;letter-spacing:-.02em} .hero h1 em{font-style:normal;color:var(--amber)}
  .hero p{color:var(--muted);max-width:760px;font-size:18px;margin:0}
  .hero .stats{display:flex;gap:28px;margin-top:24px;color:var(--muted);font-size:14px} .hero .stats b{color:var(--text)}
  .toc{max-width:1280px;margin:0 auto;padding:0 56px 32px} .toc ol{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:10px}
  .toc a{display:flex;gap:14px;align-items:baseline;padding:14px 18px;background:var(--surface);border-radius:12px;color:var(--text);text-decoration:none;border:1px solid transparent;transition:border-color .2s}
  .toc a:hover{border-color:var(--amber)} .toc a span{color:var(--gold);font-weight:600;font-size:13px} .toc a em{margin-left:auto;color:var(--muted);font-style:normal;font-size:13px}
  main{max-width:1280px;margin:0 auto;padding:0 56px 96px}
  .lesson{display:grid;grid-template-columns:72px 1fr;gap:8px;padding:48px 0;border-top:1px solid #ffffff14}
  .num{font-size:28px;font-weight:700;color:var(--amber)} .body h2{font-size:30px;margin:0 0 8px;letter-spacing:-.01em}
  .eyebrow{color:var(--muted);font-size:13px;margin:0 0 6px;letter-spacing:.06em;text-transform:uppercase}
  .summary{color:var(--muted);font-size:17px;max-width:820px;margin:0 0 24px}
  .grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:24px;align-items:start}
  video{width:100%;border-radius:14px;background:#000;display:block;box-shadow:0 30px 80px -30px #000}
  aside h3,.body h3{font-size:13px;color:var(--gold);letter-spacing:.14em;text-transform:uppercase;margin:0 0 12px}
  .body h3{margin-top:32px} ol.chapters{list-style:none;padding:0;margin:0}
  ol.chapters button{all:unset;cursor:pointer;display:flex;gap:12px;width:100%;padding:8px 10px;border-radius:8px;font-size:14px;color:var(--text)}
  ol.chapters button:hover,ol.chapters button:focus-visible{background:var(--surface)} ol.chapters span{color:var(--muted);min-width:40px;font-variant-numeric:tabular-nums}
  ul.takeaways{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  ul.takeaways li{background:var(--surface);border-radius:12px;padding:16px 18px;border-left:3px solid var(--amber)}
  ul.takeaways strong{display:block;margin-bottom:4px} ul.takeaways span{color:var(--muted);font-size:14px}
  details{margin-top:24px;background:var(--surface);border-radius:12px;padding:14px 18px} summary{cursor:pointer;color:var(--gold);font-weight:600}
  details p{color:var(--muted);margin:12px 0 0;max-width:860px}
  .pending .soon{display:inline-block;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:4px 12px;font-size:13px}
  footer{color:var(--muted);text-align:center;padding:40px;font-size:13px;border-top:1px solid #ffffff14}
  @media (max-width:960px){header,.hero,.toc,main{padding-left:20px;padding-right:20px}.grid{grid-template-columns:1fr}.lesson{grid-template-columns:1fr}.hero h1{font-size:36px}}
</style></head><body>
<header><div class="mark">${esc(brand.name)}<span>${esc(brand.platform || '')}</span></div><nav>${nav}</nav></header>
<div class="hero"><div class="eyebrow">${esc(audience)}</div><h1>${accent(title)}</h1><p>${esc(intro)}</p>
<div class="stats"><span><b>${lessons.length}</b> ${lessons.length === 1 ? 'lesson' : 'lessons'}</span>${total ? `<span><b>${Math.round(total / 60)}</b> minutes</span>` : ''}</div></div>
<nav class="toc"><ol>${toc}</ol></nav>
<main>${lessons.map(lessonHtml).join('')}</main>
<footer>${esc(brand.name)} · ${esc(brand.platform || '')}</footer>
<script>
document.querySelectorAll('ol.chapters button').forEach((b) => b.addEventListener('click', () => {
  const v = b.closest('.lesson').querySelector('video'); v.currentTime = +b.dataset.t; v.play();
}));
document.querySelectorAll('video').forEach((v) => v.addEventListener('play', () =>
  document.querySelectorAll('video').forEach((o) => o !== v && o.pause())));
</script>
</body></html>`;
}

export function buildManuals() {
  const dir = join(OUT_ROOT, 'manuals');
  mkdirSync(dir, { recursive: true });
  const { sets, lessons: all } = collectManual();
  const lessons = all.map((l) => ({
    ...l,
    src: relative(dir, l.file),
    poster: l.posterFile && relative(dir, l.posterFile),
  }));
  const written = [];
  for (const set of sets) {
    const mine = lessons.filter((l) => l.set === set.key);
    if (!mine.length) continue;
    const brand = loadBrand(set.brand || mine[0].brand || 'admiral');
    const path = join(dir, `${set.key}.html`);
    writeFileSync(
      path,
      page({ brand, title: set.heading || set.title, intro: set.intro || '', audience: set.audience || '', lessons: mine, sets, current: set.key })
    );
    const ready = mine.filter((l) => l.ready).length;
    console.log(`✓ ${set.title}: ${ready}/${mine.length} lessons ready → ${path}`);
    written.push(path);
  }
  if (sets.length) {
    const first = sets.find((s) => lessons.some((l) => l.set === s.key));
    const links = sets
      .map((s) => `<li><a href="${esc(s.key)}.html">${esc(s.title)}</a> — ${esc(plain(s.intro || ''))}</li>`)
      .join('');
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><meta charset="utf-8"/><title>Manuals</title><meta http-equiv="refresh" content="0; url=${esc(first?.key || '')}.html"/><ul>${links}</ul>`
    );
  }
  return written;
}
