/**
 * Agent-driven product exploration.
 *
 * A detached daemon holds one signed-in browser. The explore agent drives it one decision at a
 * time — `node cli.mjs browse <slug> look|click|hover|type|…` — reading each screen (numbered
 * controls, where they sit, headings, dialog, a screenshot) and choosing where to go next.
 * Code never decides what is worth showing; it only executes moves and records the map:
 * every screen seen, the move that reached it, the agent's notes, and the full DOM/form/canvas
 * inventory the flow builder needs (flow-analysis.json / .md).
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { chromium } from 'playwright';
import {
  analysisToMarkdown,
  buildRecommendations,
  capturePageReport,
  dismissCookies,
  pageHintsAggregate,
  pickPrimaryPage,
} from './analyzeFlow.mjs';
import { analysisContextOptions, captureProfile, describeCapture } from './capturePresets.mjs';
import { KIT } from './project.mjs';
import { tryCredentialSignIn } from './sessionAuth.mjs';
import { sessionFile } from './signInPause.mjs';

const IDLE_MS = Number(process.env.WALKTHROUGH_BROWSE_IDLE_MS) || 15 * 60 * 1000;
const START_TIMEOUT_MS = 120 * 1000;
const MAX_CONTROLS_SHOWN = 90;
/** Moves that cannot be undone on a real account. The agent must pass --confirm to do them. */
const IRREVERSIBLE =
  /log\s*out|sign\s*out|delete|remove account|destroy|cancel subscription|unsubscribe|pay now|checkout|purchase|buy now|empty trash|permanently|wipe/i;

export const browseDir = (video) => join(video.out, 'browse');
const sessionJson = (video) => join(browseDir(video), 'session.json');
const mapJson = (video) => join(browseDir(video), 'map.json');
const daemonLog = (video) => join(browseDir(video), 'daemon.log');

/* ------------------------------------------------------------------ page side */

/** Numbers every visible interactive element (data-wt-ref) and reads the screen. Self-contained. */
function readScreenInPage(maxRefs) {
  document.querySelectorAll('[data-wt-ref]').forEach((el) => el.removeAttribute('data-wt-ref'));
  const vw = innerWidth;
  const vh = innerHeight;
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) !== 0;
  };
  const where = (r) => {
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    if (cy < 0) return 'above the fold';
    if (cy > vh) return 'below the fold';
    if (cy < vh * 0.12) return cx > vw * 0.75 ? 'top-right' : cx < vw * 0.2 ? 'top-left' : 'top bar';
    if (cx < vw * 0.2) return 'left sidebar';
    if (cx > vw * 0.8) return 'right side';
    if (cy > vh * 0.88) return 'bottom';
    return 'main';
  };
  const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open], [role="menu"], [role="listbox"]')].filter(shown);
  const dialog = dialogs[dialogs.length - 1] || null;
  const dialogTitle = dialog
    ? (dialog.getAttribute('aria-label') || dialog.querySelector('h1, h2, h3, [class*="title" i]')?.innerText || dialog.getAttribute('role') || 'dialog')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
    : '';
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') return t;
      if (t === 'submit' || t === 'button') return 'button';
      return t === 'search' ? 'searchbox' : 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return 'clickable';
  };
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  /** Icon-only controls still get a name the agent can reason about: tooltip, target, test id. */
  const iconHint = (el) => {
    const svgTitle = el.querySelector('svg title')?.textContent;
    const tip = el.getAttribute('data-tooltip') || el.getAttribute('data-title') || el.getAttribute('data-original-title') || el.getAttribute('mattooltip');
    const described = el.getAttribute('aria-describedby') ? document.getElementById(el.getAttribute('aria-describedby'))?.innerText : '';
    const img = el.querySelector('img[alt]')?.getAttribute('alt');
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
    const iconEl = el.querySelector('[md-svg-icon], [svgicon], [data-icon], [data-lucide], use');
    const iconName =
      iconEl?.getAttribute('md-svg-icon') ||
      iconEl?.getAttribute('svgicon') ||
      iconEl?.getAttribute('data-icon') ||
      iconEl?.getAttribute('data-lucide') ||
      (iconEl?.getAttribute('href') || iconEl?.getAttribute('xlink:href') || '').replace(/^.*#/, '');
    let href = '';
    try {
      const raw = el.getAttribute('href');
      if (raw && !raw.startsWith('#') && !raw.startsWith('javascript')) href = new URL(raw, location.href).pathname;
    } catch {
      /* not a URL */
    }
    const hint = clean(svgTitle || tip || described || img || testId || iconName || '');
    if (hint) return `icon: ${hint}${href ? ` → ${href}` : ''}`;
    if (href) return `icon → ${href}`;
    return '';
  };
  const labelOf = (el) => {
    const byId = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : '';
    const text = clean(
      el.getAttribute('aria-label') ||
        byId ||
        el.innerText ||
        el.value ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.getAttribute('alt') ||
        el.getAttribute('name') ||
        ''
    );
    return (text || iconHint(el)).slice(0, 70);
  };
  /** Present and not hidden behind a drawer, overlay or off-canvas transform. */
  const reachable = (el, r) => {
    if (r.right <= 0 || r.left >= vw) return false;
    if (r.bottom <= 0 || r.top >= vh) return true;
    const x = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1);
    const top = document.elementFromPoint(x, y);
    return Boolean(top && (top === el || el.contains(top) || top.contains(el)));
  };
  const strong =
    'a[href], button, summary, select, textarea, input:not([type="hidden"]), [contenteditable="true"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [role="combobox"], [role="treeitem"], [role="gridcell"][tabindex]';
  const selector = `${strong}, [onclick], [tabindex="0"]`;
  /** A focusable or pointer wrapper around real controls is a container, not a control. */
  const isContainer = (el) => !el.matches(strong) && Boolean(el.querySelector(strong));
  const controls = [];
  const seen = new Set();
  let n = 0;
  const candidates = [...document.querySelectorAll(selector)];
  // Framework widgets often have no role: the outermost element of each pointer-cursor region.
  const all = document.body.getElementsByTagName('*');
  for (let i = 0; i < all.length && i < 6000; i++) {
    const el = all[i];
    if (el.matches(selector) || el.closest(strong)) continue;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;
    candidates.push(el);
  }
  for (const el of candidates) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < -vh || r.top > vh * 3) continue;
    if (isContainer(el)) continue;
    if (!reachable(el, r)) continue;
    if (el.parentElement?.closest('[data-wt-ref]') && !el.matches('input, select, textarea')) continue;
    const role = roleOf(el);
    const label = labelOf(el) || `unlabeled ${role} at ${Math.round(r.x + r.width / 2)},${Math.round(r.y + r.height / 2)}`;
    const key = `${role}|${label}|${Math.round(r.x / 24)}|${Math.round(r.y / 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    n += 1;
    el.setAttribute('data-wt-ref', String(n));
    controls.push({
      ref: n,
      role,
      label,
      where: where(r),
      inDialog: Boolean(dialog && dialog.contains(el)),
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      current: el.getAttribute('aria-current') === 'page' || el.getAttribute('aria-selected') === 'true',
      value: /textbox|searchbox|select|combobox/.test(role) ? String(el.value || '').slice(0, 40) : '',
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    });
    if (n >= maxRefs) break;
  }
  const headings = [...document.querySelectorAll('h1, h2, h3')]
    .filter(shown)
    .map((h) => h.innerText.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 12);
  const canvases = [...document.querySelectorAll('canvas')].filter((c) => {
    const r = c.getBoundingClientRect();
    return r.width > 200 && r.height > 150 && shown(c);
  }).length;
  const root = dialog || document.querySelector('main') || document.body;
  const gist = (root.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  return { url: location.href, title: document.title, headings, dialog: dialogTitle, controls, canvases, gist, scrollable: document.documentElement.scrollHeight > vh * 1.2 };
}

/* ---------------------------------------------------------------- daemon side */

const pathOf = (url) => {
  try {
    const u = new URL(url);
    return `${u.pathname || '/'}${u.hash && u.hash.length > 1 ? u.hash : ''}`;
  } catch {
    return url || '/';
  }
};

function screenLine(c) {
  const flags = [c.inDialog ? 'in dialog' : '', c.current ? 'current' : '', c.disabled ? 'disabled' : '', c.value ? `value “${c.value}”` : '']
    .filter(Boolean)
    .join(', ');
  return `  [${c.ref}] ${c.role} “${c.label || '(no label)'}” · ${c.where}${flags ? ` · ${flags}` : ''}`;
}

/**
 * Runs in the detached daemon process: one browser, one command at a time, until `stop`,
 * SIGTERM, or IDLE_MS without a command.
 */
export async function runBrowseDaemon(video, { url, headed = false } = {}) {
  const dir = browseDir(video);
  mkdirSync(join(dir, 'shots'), { recursive: true });
  const startUrl = url || video.config.record?.startUrl || video.config.env?.appUrl || video.config.env?.marketingUrl;
  if (!startUrl) throw new Error('No URL to explore — set record.startUrl or pass --url');
  const ctxOptions = analysisContextOptions(video.config, { maxDpr: 1 });
  const { viewport } = ctxOptions;
  const runId = Date.now().toString(36);
  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

  const browser = await chromium.launch({ headless: !headed, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
  const storage = existsSync(sessionFile(video)) ? sessionFile(video) : undefined;
  const context = await browser.newContext({ ...ctxOptions, storageState: storage });
  let page = await context.newPage();
  page.setDefaultTimeout(15000);
  context.on('page', (p) => {
    page = p;
    page.setDefaultTimeout(15000);
    log(`adopted new tab ${p.url()}`);
  });

  const state = {
    slug: video.slug,
    startUrl,
    startedAt: new Date().toISOString(),
    signedIn: false,
    screens: [],
    moves: [],
    notes: [],
    current: null,
    shot: 0,
  };
  const reports = new Map();

  const settle = async () => {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    await dismissCookies(page).catch(() => {});
  };

  const persist = () => {
    writeFileSync(mapJson(video), JSON.stringify(state, null, 2) + '\n');
    const pages = [...reports.values()];
    if (!pages.length) return;
    const primary = pickPrimaryPage(pages) || pages[0];
    const report = {
      slug: video.slug,
      analyzedAt: new Date().toISOString(),
      url: primary.url,
      title: primary.title,
      viewport,
      deviceScaleFactor: Math.min(captureProfile(video.config).dpr, 2),
      device: describeCapture(captureProfile(video.config)),
      runId,
      explore: true,
      explorer: 'agent',
      signedIn: state.signedIn,
      pages: pages.map((p) => ({ hop: p.hop, url: p.url, path: p.path, title: p.title, via: p.via, signedIn: p.signedIn, dom: p.dom, frameworks: p.frameworks, canvases: p.canvases, hints: p.hints })),
      dom: primary.dom,
      frameworks: primary.frameworks || [],
      canvases: primary.canvases || [],
      hints: pageHintsAggregate(pages),
    };
    report.recommendations = buildRecommendations(report);
    writeFileSync(join(video.dir, 'flow-analysis.json'), JSON.stringify(report, null, 2) + '\n');
    writeFileSync(join(video.dir, 'flow-analysis.md'), analysisToMarkdown(report) + '\n' + mapMarkdown(state));
  };

  const look = async () => {
    const path = pathOf(page.url());
    if (!reports.has(path)) {
      try {
        // Inventory without canvas drags or form probes: exploring must not change the app.
        const rep = await capturePageReport(page, video, { runId, probeForms: false, probeCanvasesFull: false });
        const via = state.moves.at(-1);
        reports.set(path, { ...rep, hop: reports.size, via: via ? via.label || via.action : null, signedIn: state.signedIn });
      } catch (err) {
        log(`inventory skipped on ${path}: ${err.message}`);
      }
    }
    const snap = await page.evaluate(readScreenInPage, 400);
    const key = `${pathOf(snap.url)}${snap.dialog ? ` ▸ ${snap.dialog}` : ''}`;
    let screen = state.screens.find((s) => s.key === key);
    const isNew = !screen;
    if (!screen) {
      const via = state.moves.at(-1);
      screen = {
        id: `S${state.screens.length + 1}`,
        key,
        url: snap.url,
        path: pathOf(snap.url),
        title: snap.title,
        dialog: snap.dialog || null,
        headings: snap.headings,
        reachedBy: via ? { from: via.from, action: via.action, label: via.label, where: via.where } : null,
        controls: snap.controls.length,
        tried: [],
        notes: [],
      };
      state.screens.push(screen);
    } else {
      screen.controls = snap.controls.length;
      screen.headings = snap.headings;
    }
    state.current = screen.id;
    state.shot += 1;
    const shot = join(browseDir(video), 'shots', `${String(state.shot).padStart(3, '0')}-${screen.id}.jpg`);
    await page.screenshot({ path: shot, type: 'jpeg', quality: 60 }).catch(() => {});
    state.lastControls = snap.controls.map(({ ref, role, label, where, box }) => ({ ref, role, label, where, box }));
    persist();

    const untried = state.screens.map((s) => ({ s, open: Math.max(0, s.controls - s.tried.length) })).filter((x) => x.s.id !== screen.id);
    const lines = [
      `${screen.id}${isNew ? ' (new screen)' : ''} · ${snap.title || '(untitled)'} · ${screen.path}${snap.dialog ? ` · dialog “${snap.dialog}”` : ''}`,
      `Screenshot: ${shot}`,
      `Device: ${describeCapture(captureProfile(video.config))} — the layout the video records`,
      snap.headings.length ? `Headings: ${snap.headings.join(' · ')}` : 'Headings: none',
      snap.canvases ? `Canvas: ${snap.canvases} large canvas element(s) — try drag / wheel / hover on them` : '',
      `On screen: ${snap.gist}${snap.gist.length >= 700 ? '…' : ''}`,
      `Controls (${snap.controls.length}${snap.controls.length > MAX_CONTROLS_SHOWN ? `, first ${MAX_CONTROLS_SHOWN}` : ''}) — use the [ref] with click/hover/type/select/drag:`,
      ...snap.controls.slice(0, MAX_CONTROLS_SHOWN).map(screenLine),
      snap.scrollable ? 'More below: scroll down to see the rest of the page.' : '',
      screen.tried.length ? `Already tried here: ${screen.tried.join(', ')}` : '',
      untried.length ? `Map: ${state.screens.length} screen(s) · ${untried.map((x) => `${x.s.id} ${x.s.title || x.s.path}`).slice(0, 12).join(' · ')}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  };

  const target = (ref) => {
    const n = Number(String(ref || '').replace(/[^\d]/g, ''));
    if (!n) throw new Error('Give a control ref from the last look, e.g. click 12');
    const info = state.lastControls?.find((c) => c.ref === n);
    return { n, info, loc: page.locator(`[data-wt-ref="${n}"]`).first() };
  };

  const recordMove = (action, info, extra = {}) => {
    const from = state.screens.find((s) => s.id === state.current);
    const label = info?.label || extra.label || '';
    if (from && label && !from.tried.includes(label)) from.tried.push(label);
    state.moves.push({ at: new Date().toISOString(), from: state.current, action, label, where: info?.where || '', ...extra });
  };

  const guard = (info, args) => {
    if (info?.label && IRREVERSIBLE.test(info.label) && !args.includes('--confirm')) {
      throw new Error(`“${info.label}” looks irreversible on a real account. Pick another move, or repeat with --confirm if the brief allows it.`);
    }
  };

  const withRef = async (args, run) => {
    const { info, loc } = target(args[0]);
    if (!(await loc.count())) throw new Error(`[${args[0]}] is no longer on screen — run look and pick again`);
    guard(info, args);
    await run(loc, info);
    return info;
  };

  const commands = {
    look: async () => look(),
    click: async (args) => {
      const info = await withRef(args, async (loc) => {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ timeout: 8000 }).catch(() => loc.click({ timeout: 4000, force: true }));
      });
      recordMove('click', info);
      await settle();
      return `✓ clicked [${args[0]}] “${info?.label || ''}”\n\n${await look()}`;
    },
    hover: async (args) => {
      const info = await withRef(args, async (loc) => {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.hover({ timeout: 6000 });
      });
      recordMove('hover', info);
      await page.waitForTimeout(700);
      return `✓ hovering [${args[0]}] “${info?.label || ''}” (look for tooltips / previews in the screenshot)\n\n${await look()}`;
    },
    type: async (args) => {
      const [ref, ...rest] = args;
      const enter = rest.includes('--enter');
      const text = rest.filter((a) => a !== '--enter' && a !== '--confirm').join(' ');
      if (!text) throw new Error('Usage: type <ref> "text" [--enter]');
      const info = await withRef([ref, ...rest], async (loc) => {
        await loc.click({ timeout: 6000 }).catch(() => {});
        await loc.fill(text).catch(async () => {
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
          await page.keyboard.type(text, { delay: 20 });
        });
        if (enter) await page.keyboard.press('Enter');
      });
      recordMove('type', info, { text });
      await settle();
      return `✓ typed “${text}” into [${ref}]${enter ? ' + Enter' : ''}\n\n${await look()}`;
    },
    select: async (args) => {
      const [ref, ...rest] = args;
      const value = rest.join(' ');
      const info = await withRef([ref], async (loc) => {
        await loc.selectOption({ label: value }).catch(() => loc.selectOption(value));
      });
      recordMove('select', info, { text: value });
      await settle();
      return `✓ selected “${value}” in [${ref}]\n\n${await look()}`;
    },
    drag: async (args) => {
      const [ref, dx = '120', dy = '0'] = args;
      const info = await withRef([ref], async (loc) => {
        const box = await loc.boundingBox();
        if (!box) throw new Error(`[${ref}] has no box to drag`);
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + Number(dx), y + Number(dy), { steps: 14 });
        await page.mouse.up();
      });
      recordMove('drag', info, { text: `${dx},${dy}` });
      await settle();
      return `✓ dragged [${ref}] by ${dx},${dy}\n\n${await look()}`;
    },
    press: async (args) => {
      const key = args[0] || 'Escape';
      await page.keyboard.press(key);
      recordMove('press', null, { label: key });
      await settle();
      return `✓ pressed ${key}\n\n${await look()}`;
    },
    scroll: async (args) => {
      const dir = (args[0] || 'down').toLowerCase();
      const amount = Number(args[1]) || 700;
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, dir === 'up' ? -amount : amount);
      await page.waitForTimeout(600);
      recordMove('scroll', null, { label: `scroll ${dir}` });
      return `✓ scrolled ${dir}\n\n${await look()}`;
    },
    goto: async (args) => {
      const to = args.join(' ').trim();
      if (!to) throw new Error('Usage: goto <url or /path>');
      const url = /^https?:/i.test(to) ? to : new URL(to, page.url()).href;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      recordMove('goto', null, { label: pathOf(url) });
      await settle();
      return `✓ opened ${url}\n\n${await look()}`;
    },
    back: async () => {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      recordMove('back', null, { label: 'back' });
      await settle();
      return `✓ back\n\n${await look()}`;
    },
    note: async (args) => {
      const text = args.join(' ').trim();
      if (!text) throw new Error('Usage: note "what you learned here"');
      const screen = state.screens.find((s) => s.id === state.current);
      if (screen) screen.notes.push(text);
      state.notes.push({ screen: state.current, text, at: new Date().toISOString() });
      persist();
      return `✓ noted on ${state.current}: ${text}`;
    },
    map: async () => mapText(state),
    stop: async () => {
      persist();
      setTimeout(shutdown, 50);
      return `✓ session closed · ${state.screens.length} screen(s), ${state.moves.length} move(s) · map → ${mapJson(video)} · product map → ${join(video.dir, 'flow-analysis.md')}`;
    },
  };

  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    try {
      persist();
      if (state.signedIn) await context.storageState({ path: sessionFile(video) }).catch(() => {});
    } finally {
      await browser.close().catch(() => {});
      rmSync(sessionJson(video), { force: true });
      process.exit(0);
    }
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  log(`opening ${startUrl}`);
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle();
  const pwd = page.locator('input[type="password"]').first();
  if (await pwd.isVisible({ timeout: 2500 }).catch(() => false)) {
    const login = await tryCredentialSignIn(page, video, log);
    state.signedIn = Boolean(login.ok);
    if (login.ok) {
      await settle();
      await context.storageState({ path: sessionFile(video) }).catch(() => {});
    } else {
      state.signInNote = `Sign-in needed but not completed (${login.reason || 'unknown'}). Explore what is public, or ask the reviewer for demo credentials.`;
    }
  } else {
    state.signedIn = Boolean(storage);
  }

  let queue = Promise.resolve();
  let idle = setTimeout(shutdown, IDLE_MS);
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/ping') {
      res.end(JSON.stringify({ ok: true, current: state.current }));
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      clearTimeout(idle);
      idle = setTimeout(shutdown, IDLE_MS);
      queue = queue.then(async () => {
        let out;
        try {
          const { cmd, args = [] } = JSON.parse(body || '{}');
          const run = commands[cmd];
          if (!run) throw new Error(`Unknown command “${cmd}”. Use: ${Object.keys(commands).join(', ')}`);
          out = { ok: true, text: await run(args) };
          log(`${cmd} ${args.join(' ')}`);
        } catch (err) {
          out = { ok: false, text: `✗ ${err.message || err}` };
          log(`error: ${err.message || err}`);
        }
        res.end(JSON.stringify(out));
      });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  writeFileSync(
    sessionJson(video),
    JSON.stringify({ pid: process.pid, port: server.address().port, startUrl, startedAt: state.startedAt, signedIn: state.signedIn, signInNote: state.signInNote || null }, null, 2)
  );
  log(`ready on ${server.address().port}`);
}

function mapText(state) {
  const lines = [`Explored ${state.screens.length} screen(s) with ${state.moves.length} move(s) from ${state.startUrl}${state.signedIn ? ' (signed in)' : ''}`];
  for (const s of state.screens) {
    const via = s.reachedBy ? ` ← ${s.reachedBy.from} ${s.reachedBy.action} “${s.reachedBy.label}”${s.reachedBy.where ? ` (${s.reachedBy.where})` : ''}` : ' (start)';
    lines.push(`${s.id} ${s.title || '(untitled)'} · ${s.path}${s.dialog ? ` · dialog “${s.dialog}”` : ''}${via}`);
    lines.push(`   ${s.controls} controls · tried ${s.tried.length}${s.tried.length ? `: ${s.tried.slice(-10).join(', ')}` : ''}`);
    for (const n of s.notes) lines.push(`   note: ${n}`);
  }
  return lines.join('\n');
}

function mapMarkdown(state) {
  const lines = ['', '## Agent exploration map', ''];
  lines.push(mapText(state).split('\n').map((l) => (l.startsWith('   ') ? `  - ${l.trim()}` : `- ${l}`)).join('\n'));
  lines.push('');
  return lines.join('\n');
}

/* ---------------------------------------------------------------- client side */

function readSession(video) {
  try {
    return JSON.parse(readFileSync(sessionJson(video), 'utf8'));
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function request(session, method, path, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: session.port, method, path, headers: { 'content-type': 'application/json' }, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Bad reply from browse session: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('browse session did not answer in time')));
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function liveSession(video) {
  const s = readSession(video);
  if (!s?.port || !alive(s.pid)) return null;
  try {
    const pong = await request(s, 'GET', '/ping', null, 2500);
    return pong?.ok ? s : null;
  } catch {
    return null;
  }
}

async function startDaemon(video, { url, headed } = {}) {
  mkdirSync(browseDir(video), { recursive: true });
  rmSync(sessionJson(video), { force: true });
  const logFd = openSync(daemonLog(video), 'a');
  const args = [join(KIT, 'cli.mjs'), 'browse-daemon', video.slug];
  if (url) args.push('--url', url);
  if (headed) args.push('--headed');
  const child = spawn(process.execPath, args, { cwd: KIT, detached: true, stdio: ['ignore', logFd, logFd], env: process.env });
  child.unref();
  closeSync(logFd);
  let exited = null;
  child.on('exit', (code) => (exited = code));
  const t0 = Date.now();
  while (Date.now() - t0 < START_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 400));
    const s = await liveSession(video);
    if (s) return s;
    if (exited !== null) break;
  }
  const tail = existsSync(daemonLog(video)) ? readFileSync(daemonLog(video), 'utf8').split('\n').slice(-12).join('\n') : '';
  throw new Error(`Browse session did not start${exited !== null ? ` (exit ${exited})` : ''}.\n${tail}`);
}

/** One agent move. Starts the session on demand so the agent never has to manage it. */
export async function browseCommand(video, cmd = 'look', args = [], { url, headed } = {}) {
  let session = await liveSession(video);
  if (cmd === 'stop' && !session) return 'No browse session running.';
  let preface = '';
  if (!session) {
    session = await startDaemon(video, { url, headed });
    preface = `Browser session started at ${session.startUrl}${session.signedIn ? ' · signed in' : ''}${session.signInNote ? `\n⚠ ${session.signInNote}` : ''}\n\n`;
  }
  const reply = await request(session, 'POST', '/cmd', { cmd: cmd === 'start' ? 'look' : cmd, args });
  if (!reply.ok) process.exitCode = 1;
  return preface + reply.text;
}

/** Ends a session left open by an agent (job finished, cancelled or timed out). */
export function stopBrowseSession(video) {
  const s = readSession(video);
  if (s?.pid && alive(s.pid)) {
    try {
      process.kill(s.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

export function readBrowseMap(video) {
  try {
    return JSON.parse(readFileSync(mapJson(video), 'utf8'));
  } catch {
    return null;
  }
}
