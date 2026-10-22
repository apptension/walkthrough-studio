# Studio icons

SVG files here are the source of truth for every Studio glyph — the "Deck" set:
one 24-unit grid, one 1.75 stroke, motifs taken from the isometric mark.

```
icons/
  ui/          24×24 chrome, timeline, section marks
  focus/       Feature-focus diagrams (44×34, coloured by .fg-* in styles.css)
  empty/       Program empty-state marks (64×64 — the 24 grid × 8/3)
  agents/      Cursor / Claude logos (third-party, carried over as-is)
  zen/         Empty-panel illustrations (96×64, animated by .z-* in styles.css)
  build.mjs    → ../icons.svg + ../icons.gen.js + refreshed embeds in ../index.html
```

After adding or editing an SVG:

```bash
node kit/studio/icons/build.mjs
```

The generator that drew this set (grammar, every glyph as code, and the v1 ↔ v2
compare page) lives outside the tracked tree in `kit/tmp/icon-lab/` — see its
README. Hand edits to the SVGs here are fine; re-running the generator overwrites them.

Embed from JS:

```js
import { icon, ICONS } from './icons.js';
icon('play', { size: 14 });
```

In `index.html`, write `<svg …><use href="/icons.svg#ui-play"/></svg>` and run the
build: it inlines the file's markup and paint attrs and tags the host with
`data-sprite="ui-play"`, so every later build refreshes that embed from the source.

Hydrate hosts when CSS targets inner classes (focus glyphs, agents):

```html
<span data-icon="focus-guided" data-width="44" data-height="34"></span>
```

`mountIcons()` / `mountZen()` fill those hosts on boot.
