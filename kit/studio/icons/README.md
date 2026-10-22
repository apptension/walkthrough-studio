# Studio icons

SVG files here are the source of truth for every Studio glyph.

```
icons/
  ui/          24×24 chrome, timeline, section marks
  focus/       Feature-focus diagrams (44×34)
  empty/       Program empty-state marks (64×64)
  agents/      Cursor / Claude logos
  zen/         Empty-panel illustrations (96×64)
  build.mjs    → ../icons.svg + ../icons.gen.js
  seed.mjs     one-shot bootstrap from the old inline set
```

After adding or editing an SVG:

```bash
node kit/studio/icons/build.mjs
```

Embed from JS:

```js
import { icon, ICONS } from './icons.js';
icon('play', { size: 14 });
```

Do **not** hand-write `<use href="/icons.svg#…">` in HTML. `build.mjs` inlines
every such reference into a real `<svg>` with the source file’s fill/stroke attrs
(so cogs and other stroke icons stay visible on the dark UI).

Hydrate hosts when CSS targets inner classes (focus glyphs, agents):

```html
<span data-icon="focus-guided" data-width="44" data-height="34"></span>
```

`mountIcons()` / `mountZen()` fill those hosts on boot.
