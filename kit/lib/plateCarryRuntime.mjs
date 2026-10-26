/**
 * The page half of background continuity (see plateCarry.mjs). Kept free of imports so
 * atmosphere.mjs can embed it in every plate without a module cycle.
 */
/**
 * Page runtime. Serialised into every plate (`installPlateCarry.toString()`), so it must stay
 * self-contained: no imports, no outer names.
 *
 * Carry on restructures the page once: the backdrop layers (.bg, the field, blobs, grid) move
 * into `.wt-backdrop` under the copy — out of the stage's push-in, which would scale the field
 * differently on each plate — and the vignette and grain move into `.wt-frontdrop` above it.
 * Missing blobs are supplied so every carried plate paints the same backdrop. `layer` lets the
 * Studio split one plate across two frames: 'backdrop' (only the background) and 'content'
 * (copy over transparency). Carry off puts every node back where it was.
 */
export function installPlateCarry(win) {
  if (win.__plateCarry) return win.__plateCarry;
  const doc = win.document;
  const html = doc.documentElement;
  const STYLE_ID = 'wt-carry-style';
  const CYCLE = 7;
  const CSS = [
    '.wt-backdrop,.wt-frontdrop{position:absolute;inset:0;overflow:hidden;pointer-events:none}',
    '.wt-backdrop{z-index:0}',
    '.stage.wt-backdrop{animation:none!important;transform:none!important}',
    `html[data-carry] .wt-backdrop .blob{animation:drift ${CYCLE}s cubic-bezier(0.45,0,0.55,1) 0s infinite alternate both!important}`,
    'html[data-carry-in] .black{opacity:0;animation:blackOut 0.7s var(--black-out) cubic-bezier(0.4,0,0.6,1) forwards!important}',
    'html[data-carry-out] .black{animation:blackIn 0.75s 0s cubic-bezier(0.4,0,0.2,1) both!important}',
    'html[data-carry-in][data-carry-out] .black{animation:none!important;opacity:0!important}',
    "html[data-carry-layer='backdrop'] .stage:not(.wt-backdrop),html[data-carry-layer='backdrop'] .wt-frontdrop,html[data-carry-layer='backdrop'] .black{visibility:hidden!important}",
    "html[data-carry-layer='content'],html[data-carry-layer='content'] body{background:transparent!important}",
    "html[data-carry-layer='content'] .wt-backdrop{visibility:hidden!important}",
  ].join('\n');
  const moved = [];
  const created = [];
  const state = { on: false, in: false, out: false, layer: 'full' };

  function build() {
    const stage = doc.querySelector('.stage');
    if (!stage || doc.querySelector('.wt-backdrop')) return;
    const back = doc.createElement('div');
    back.className = 'stage wt-backdrop';
    back.setAttribute('aria-hidden', 'true');
    const front = doc.createElement('div');
    front.className = 'wt-frontdrop';
    front.setAttribute('aria-hidden', 'true');
    const move = (el, into) => {
      moved.push({ el, parent: el.parentNode, next: el.nextSibling });
      into.appendChild(el);
    };
    const isBack = (el) => el.matches('.bg, .plate-field, .blob, .grid');
    for (const el of Array.from(stage.children)) if (isBack(el)) move(el, back);
    const add = (cls, before) => {
      const el = doc.createElement('div');
      el.className = cls;
      back.insertBefore(el, before || null);
      created.push(el);
    };
    if (!back.querySelector('.bg')) add('bg', back.firstChild);
    if (!back.querySelector('.blob.warm')) add('blob warm', back.querySelector('.grid'));
    if (!back.querySelector('.blob.cool')) add('blob cool', back.querySelector('.grid'));
    if (!back.querySelector('.grid')) add('grid');
    // The copy's own rules key off `.stage:has(.plate-field)` (the softened bloom) — keep a marker.
    if (back.querySelector('.plate-field')) {
      const mark = doc.createElement('i');
      mark.className = 'plate-field wt-field-mark';
      mark.hidden = true;
      stage.appendChild(mark);
      created.push(mark);
    }
    for (const el of Array.from(stage.children)) if (el.matches('.vignette')) move(el, front);
    for (const el of Array.from(doc.body.children)) if (el.matches('.grain')) move(el, front);
    stage.parentNode.insertBefore(back, stage);
    stage.parentNode.insertBefore(front, stage.nextSibling);
    created.push(back, front);
  }

  function unbuild() {
    for (let i = moved.length - 1; i >= 0; i--) {
      const { el, parent, next } = moved[i];
      parent.insertBefore(el, next && next.parentNode === parent ? next : null);
    }
    moved.length = 0;
    for (const el of created.splice(0)) el.remove();
  }

  function runtime() {
    return win.__plateRuntime || win.__plateField || null;
  }

  function set(opts) {
    if (!opts) return clear();
    build();
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      (doc.head || html).appendChild(style);
    }
    state.on = true;
    state.in = Boolean(opts.in);
    state.out = Boolean(opts.out);
    state.layer = opts.layer === 'backdrop' || opts.layer === 'content' ? opts.layer : 'full';
    html.setAttribute('data-carry', '1');
    html.toggleAttribute('data-carry-in', state.in);
    html.toggleAttribute('data-carry-out', state.out);
    html.setAttribute('data-carry-layer', state.layer);
    const rt = runtime();
    if (rt && rt.carry) {
      rt.carry.in = state.in;
      rt.carry.out = state.out;
      rt.carry.blackOut = Number.isFinite(opts.blackOut) ? opts.blackOut : null;
    }
    return api;
  }

  function clear() {
    unbuild();
    doc.getElementById(STYLE_ID)?.remove();
    for (const a of ['data-carry', 'data-carry-in', 'data-carry-out', 'data-carry-layer']) html.removeAttribute(a);
    state.on = false;
    state.in = false;
    state.out = false;
    state.layer = 'full';
    const rt = runtime();
    if (rt && rt.carry) {
      rt.carry.in = false;
      rt.carry.out = false;
      rt.carry.blackOut = null;
    }
    return api;
  }

  /** Step the copy to `contentMs` and the backdrop to `bgMs` (CSS animations, field, hooks). */
  function seek(contentMs, bgMs) {
    const c = Math.max(0, Number(contentMs) || 0);
    const b = state.on && Number.isFinite(Number(bgMs)) ? Math.max(0, Number(bgMs)) : c;
    const back = doc.querySelector('.wt-backdrop');
    const front = doc.querySelector('.wt-frontdrop');
    for (const a of doc.getAnimations()) {
      const t = a.effect && a.effect.target;
      const onBack = Boolean(t && ((back && back.contains(t)) || (front && front.contains(t))));
      try {
        a.pause();
        a.currentTime = onBack ? b : c;
      } catch (e) {
        /* an animation torn down mid-step */
      }
    }
    const rt = runtime();
    if (rt && typeof rt.renderAt === 'function') rt.renderAt(c, b);
  }

  const api = {
    set,
    clear,
    seek,
    get state() {
      return { on: state.on, in: state.in, out: state.out, layer: state.layer };
    },
  };
  win.__plateCarry = api;
  return api;
}

/** `<script>` body that installs the runtime on the plate page. */
export function plateCarryRuntimeSource() {
  return `${installPlateCarry.toString()}\ninstallPlateCarry(window);`;
}
